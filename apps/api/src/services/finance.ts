import { prisma } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import type { AuthUser } from '../plugins/auth.js';
import { getSetting } from '../lib/settings.js';
import { newToken } from '../lib/tokens.js';
import { pdf } from '../integrations/index.js';
import { createApproval, registerApprovalHandler } from './approvals.js';
import { sendTemplated, sendToClient3 } from './messaging.js';
import { notify, notifyAdmins } from './notifications.js';
import { setEngineerStatusByKey, setStage } from './stage.js';
import { config } from '../config.js';
import { enqueue } from '../jobs/queue.js';

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function pipeline(u: AuthUser, leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { pipeline: { include: { milestones: { orderBy: { order: 'asc' }, include: { invoice: { include: { payments: true } } } } } } } });
  if (!lead) throw notFound('Lead');
  if (u.role === 'engineer' && lead.engineerUserId !== u.id) throw forbidden('Not your lead');
  return lead.pipeline;
}

async function milestoneFor(id: string) {
  const m = await prisma.milestone.findUnique({ where: { id }, include: { pipeline: { include: { lead: { include: { client: true, billing: true } }, quoteVersion: true, milestones: true } } } });
  if (!m) throw notFound('Milestone');
  return m;
}

export async function patchMilestone(u: AuthUser, id: string, input: { dueDate?: string | null; amount?: number }) {
  const m = await milestoneFor(id);
  if (m.status !== 'pending') throw conflict('MILESTONE_LOCKED', 'Milestone already invoiced');
  const data: any = {};
  if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
  if (input.amount !== undefined) {
    // Rule 9.9: amount change implies pct change ⇒ approval
    const newPct = r2((input.amount / m.pipeline.quoteVersion.total) * 100);
    if (Math.abs(newPct - m.pct) > 0.001) throw conflict('PCT_CHANGE_REQUIRES_APPROVAL', 'Changing the amount changes the %; request a pct change approval', { newPct });
  }
  return prisma.milestone.update({ where: { id }, data });
}

export async function requestPctChange(u: AuthUser, id: string, newPct: number, reason: string) {
  const m = await milestoneFor(id);
  if (m.status !== 'pending') throw conflict('MILESTONE_LOCKED', 'Milestone already invoiced');
  return createApproval({ type: 'milestone_pct_change', entityType: 'Milestone', entityId: id, leadId: m.pipeline.leadId, requestedByUserId: u.id, payload: { newPct, oldPct: m.pct, reason } });
}
registerApprovalHandler('milestone_pct_change', async (a, approve, _u, remark) => {
  const m = await milestoneFor(a.entityId);
  if (approve) {
    const newPct = Number(a.payload.newPct);
    const delta = newPct - m.pct;
    // Redistribute the delta over the remaining pending milestones (last first) so schedule still sums to 100.
    const others = m.pipeline.milestones.filter((x) => x.id !== m.id && x.status === 'pending').sort((x, y) => y.order - x.order);
    if (!others.length) throw badRequest('No other pending milestone to rebalance');
    const total = m.pipeline.quoteVersion.total;
    await prisma.$transaction(async (tx) => {
      await tx.milestone.update({ where: { id: m.id }, data: { pct: newPct, amount: r2((total * newPct) / 100) } });
      let remaining = delta;
      for (const o of others) { const take = Math.min(o.pct, remaining); const pct = r2(o.pct - take); remaining = r2(remaining - take); await tx.milestone.update({ where: { id: o.id }, data: { pct, amount: r2((total * pct) / 100) } }); if (remaining <= 0) break; }
    });
  }
  await notify(a.requestedByUserId, 'pct_change_decided', approve ? 'Milestone % change approved' : 'Milestone % change rejected', remark ?? '', `/finance/leads/${m.pipeline.leadId}`);
});

export async function pushBackToEngineer(u: AuthUser, leadId: string, reason: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { pipeline: { include: { milestones: true } } } });
  if (!lead?.pushedToFinanceAt) throw conflict('NOT_IN_FINANCE', 'Lead is not with finance');
  if (lead.pipeline?.milestones.some((m) => m.status !== 'pending')) throw conflict('INVOICED', 'Cannot push back after invoicing');
  await prisma.note.create({ data: { leadId, text: `Pushed back by finance: ${reason}`, byUserId: u.id } });
  await setEngineerStatusByKey(leadId, 'asked_quote', u.id, reason);
  if (lead.engineerUserId) await notify(lead.engineerUserId, 'pushed_to_finance', 'Finance pushed the lead back', reason, `/engineer/leads/${leadId}?tab=quote`);
  return { ok: true };
}

/* ---------- invoice numbering (rule 9.10): {PREFIX}/{FY}/{SEQ}, per FY, in a transaction at send ---------- */
export function fyLabel(d: Date, resetMonth: number) {
  const y = d.getMonth() + 1 >= resetMonth ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String(y + 1).slice(-2)}`;
}
async function nextNumber(tx: any, table: 'invoice' | 'receipt' | 'creditNote', series: string, fy: string) {
  const prefix = `${series}/${fy}/`;
  if (table === 'invoice') {
    const last = await tx.invoice.findFirst({ where: { fullNumber: { startsWith: prefix } }, orderBy: { number: 'desc' } });
    return (last?.number ?? 0) + 1;
  }
  if (table === 'receipt') { const last = await tx.receipt.findFirst({ where: { fullNumber: { startsWith: prefix } }, orderBy: { number: 'desc' } }); return (last?.number ?? 0) + 1; }
  const last = await tx.creditNote.findFirst({ where: { series: prefix }, orderBy: { number: 'desc' } }); return (last?.number ?? 0) + 1;
}

export async function createInvoice(u: AuthUser, milestoneId: string) {
  const m = await milestoneFor(milestoneId);
  if (m.status !== 'pending') throw conflict('ALREADY_INVOICED', 'Milestone already invoiced');
  const lead = m.pipeline.lead;
  if (!lead.billing) throw conflict('BILLING_INCOMPLETE', 'Billing details missing');
  const [gstPct, hsnSac, branding, series] = await Promise.all([getSetting<number>('gstPct'), getSetting<string>('hsnSac'), getSetting<any>('branding'), getSetting<string>('invoiceSeries')]);
  const intra = (branding?.state ?? '').trim().toLowerCase() === lead.billing.state.trim().toLowerCase();
  const subtotal = r2(m.amount / (1 + Number(gstPct) / 100));
  const gst = r2(m.amount - subtotal);
  const inv = await prisma.$transaction(async (tx) => {
    const i = await tx.invoice.create({ data: { leadId: lead.id, milestoneId: m.id, series, lines: [{ description: `${m.name} (${m.pct}% of quote v${m.pipeline.quoteVersion.versionNo})`, amount: subtotal }], placeOfSupplyState: lead.billing!.state, cgst: intra ? r2(gst / 2) : 0, sgst: intra ? r2(gst - r2(gst / 2)) : 0, igst: intra ? 0 : gst, gstPct: Number(gstPct), hsnSac: String(hsnSac), subtotal, total: m.amount, text: '', clientToken: newToken(), status: 'draft' } });
    await tx.milestone.update({ where: { id: m.id }, data: { invoiceId: i.id, status: 'invoiced' } });
    return i;
  });
  return prisma.invoice.update({ where: { id: inv.id }, data: { text: invoiceText(inv, lead.billing, lead.client.name ?? lead.client.phone) } });
}
const invoiceText = (i: any, b: any, clientName: string) => `TAX INVOICE ${i.fullNumber ?? '(draft)'}\nDate: ${i.issueDate ? new Date(i.issueDate).toDateString() : '(unsent)'}\nBill to: ${b.legalName}, ${b.billingAddress}, ${b.state}, GSTIN ${b.gstin ?? '-'}\nClient: ${clientName}\nSite: ${b.siteAddress}\n\n${(i.lines as any[]).map((l) => `- ${l.description}: ${l.amount}`).join('\n')}\nSubtotal: ${i.subtotal}\n${i.igst ? `IGST ${i.gstPct}%: ${i.igst}` : `CGST ${i.gstPct / 2}%: ${i.cgst}\nSGST ${i.gstPct / 2}%: ${i.sgst}`}\nTotal: ${i.total}\nHSN/SAC: ${i.hsnSac} · Place of supply: ${i.placeOfSupplyState}\n`;

async function renderInvoicePdf(id: string) {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id }, include: { lead: { include: { billing: true, client: true } } } });
  const key = `invoices/${inv.leadId}/${(inv.fullNumber ?? inv.id).replace(/\//g, '-')}.pdf`;
  await pdf.render('invoice', { title: 'Tax Invoice', docNumber: inv.fullNumber, date: inv.issueDate?.toDateString(), invoice: inv, billing: inv.lead.billing, clientName: inv.lead.client.name }, key);
  return key;
}

export async function sendInvoice(u: AuthUser, id: string) {
  const inv0 = await prisma.invoice.findUnique({ where: { id }, include: { lead: { include: { client: true, billing: true } } } });
  if (!inv0) throw notFound('Invoice');
  if (inv0.status !== 'draft') throw conflict('ALREADY_SENT', 'Invoice already sent');
  const [series, resetMonth] = await Promise.all([getSetting<string>('invoiceSeries'), getSetting<number>('fyResetMonth')]);
  const now = new Date(); const fy = fyLabel(now, Number(resetMonth));
  const inv = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoice:' + series + ':' + fy}))`;
    const number = await nextNumber(tx, 'invoice', series, fy);
    const i = await tx.invoice.update({ where: { id }, data: { number, fullNumber: `${series}/${fy}/${String(number).padStart(4, '0')}`, issueDate: now, status: 'sent', sentAt: now } });
    return tx.invoice.update({ where: { id }, data: { text: invoiceText(i, inv0.lead.billing, inv0.lead.client.name ?? inv0.lead.client.phone) } });
  });
  const pdfKey = await renderInvoicePdf(id);
  await prisma.invoice.update({ where: { id }, data: { pdfKey } });
  const link = `${config.appUrl}/p/invoice/${inv.clientToken}`;
  await sendToClient3({ leadId: inv.leadId, clientId: inv0.lead.clientId, client: inv0.lead.client, templateKey: 'invoice_link', whatsappTemplateKey: 'invoice_pdf', vars: { client_name: inv0.lead.client.name ?? 'there', invoice_number: inv.fullNumber!, invoice_link: link, amount: inv.total }, attachmentKey: pdfKey, byUserId: u.id });
  await setStage(inv.leadId, 'invoice_sent', u.id);
  if (inv0.lead.engineerUserId) await notify(inv0.lead.engineerUserId, 'invoice_sent', `Invoice ${inv.fullNumber} sent`, `${inv0.lead.client.name ?? ''} · ₹${inv.total}`, `/engineer/leads/${inv.leadId}`);
  await enqueue('embed_document', { docType: 'invoice', docId: inv.id, leadId: inv.leadId, clientId: inv0.lead.clientId, text: inv.text, meta: { number: inv.fullNumber } });
  return { ...inv, pdfKey };
}

/* Rule 9.10: payment ⇒ status, receipt, messages, engineer status on milestone 1 */
export async function recordPayment(u: AuthUser, invoiceId: string, input: { amount: number; mode: any; reference?: string; paidOn: string }) {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true, milestone: true, lead: { include: { client: true } } } });
  if (!inv) throw notFound('Invoice');
  if (inv.status === 'draft' || inv.status === 'cancelled') throw conflict('BAD_STATE', 'Invoice not sent');
  const paidSoFar = inv.payments.reduce((a, p) => a + p.amount, 0);
  if (paidSoFar + input.amount > inv.total + 0.01) throw badRequest('Payment exceeds invoice balance');
  const [series, resetMonth, branding] = await Promise.all([getSetting<string>('receiptSeries'), getSetting<number>('fyResetMonth'), getSetting<any>('branding')]);
  const fy = fyLabel(new Date(), Number(resetMonth));
  const nowPaid = paidSoFar + input.amount;
  const fullyPaid = nowPaid >= inv.total - 0.01;
  const { payment, receipt } = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({ data: { invoiceId, amount: input.amount, mode: input.mode, reference: input.reference, paidOn: new Date(input.paidOn), byUserId: u.id } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'receipt:' + series + ':' + fy}))`;
    const number = await nextNumber(tx, 'receipt', series, fy);
    const fullNumber = `${series}/${fy}/${String(number).padStart(4, '0')}`;
    const text = `RECEIPT ${fullNumber}\nReceived from ${inv.lead.client.name ?? inv.lead.client.phone} ₹${input.amount} by ${input.mode}${input.reference ? ' (' + input.reference + ')' : ''} on ${new Date(input.paidOn).toDateString()} against ${inv.fullNumber}.\nThank you.\n${branding?.companyName ?? ''}`;
    const receipt = await tx.receipt.create({ data: { paymentId: payment.id, series, number, fullNumber, text, clientToken: newToken() } });
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: fullyPaid ? 'paid' : 'partially_paid' } });
    if (fullyPaid && inv.milestone) await tx.milestone.update({ where: { id: inv.milestone.id }, data: { status: 'paid' } });
    return { payment, receipt };
  });
  const key = `receipts/${inv.leadId}/${receipt.fullNumber.replace(/\//g, '-')}.pdf`;
  await pdf.render('receipt', { title: 'Receipt', docNumber: receipt.fullNumber, date: new Date(input.paidOn).toDateString(), clientName: inv.lead.client.name ?? inv.lead.client.phone, amount: input.amount, mode: input.mode, reference: input.reference, paidOn: new Date(input.paidOn).toDateString(), invoiceNumber: inv.fullNumber }, key);
  await prisma.receipt.update({ where: { id: receipt.id }, data: { pdfKey: key, sentAt: new Date() } });
  const link = `${config.appUrl}/p/receipt/${receipt.clientToken}`;
  await sendToClient3({ leadId: inv.leadId, clientId: inv.lead.clientId, client: inv.lead.client, templateKey: 'receipt_thankyou', vars: { client_name: inv.lead.client.name ?? 'there', amount: input.amount, receipt_link: link, invoice_number: inv.fullNumber ?? '' }, attachmentKey: key, byUserId: u.id });
  // email to engineer + admin
  const engineer = inv.lead.engineerUserId ? await prisma.user.findUnique({ where: { id: inv.lead.engineerUserId } }) : null;
  if (engineer) { await sendTemplated({ leadId: inv.leadId, channel: 'email', templateKey: 'receipt_thankyou', to: engineer.email, subject: `Payment received ${receipt.fullNumber}`, vars: { client_name: inv.lead.client.name ?? '', amount: input.amount, receipt_link: link, invoice_number: inv.fullNumber ?? '' } }); await notify(engineer.id, 'invoice_paid', 'Payment received', `₹${input.amount} against ${inv.fullNumber}`, `/engineer/leads/${inv.leadId}`); }
  for (const a of await prisma.user.findMany({ where: { role: 'admin', active: true } })) await sendTemplated({ leadId: inv.leadId, channel: 'email', templateKey: 'receipt_thankyou', to: a.email, subject: `Payment received ${receipt.fullNumber}`, vars: { client_name: inv.lead.client.name ?? '', amount: input.amount, receipt_link: link, invoice_number: inv.fullNumber ?? '' } });
  await notifyAdmins('invoice_paid', 'Payment received', `₹${input.amount} · ${inv.lead.client.name ?? ''}`, `/admin/projects`);
  if (fullyPaid && inv.milestone?.order === 1) {
    await setEngineerStatusByKey(inv.leadId, 'advance_paid', u.id);
    await setStage(inv.leadId, 'advance_paid', u.id);
  }
  await enqueue('embed_document', { docType: 'receipt', docId: receipt.id, leadId: inv.leadId, clientId: inv.lead.clientId, text: receipt.text, meta: { number: receipt.fullNumber } });
  return { payment, receipt: { ...receipt, pdfKey: key } };
}

export async function requestCreditNote(u: AuthUser, invoiceId: string, amount: number, reason: string) {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv || inv.status === 'draft') throw conflict('BAD_STATE', 'Invoice not sent');
  if (amount <= 0 || amount > inv.total) throw badRequest('Invalid amount');
  return createApproval({ type: 'credit_note', entityType: 'Invoice', entityId: invoiceId, leadId: inv.leadId, requestedByUserId: u.id, payload: { amount, reason } });
}
registerApprovalHandler('credit_note', async (a, approve, _u, remark) => {
  if (approve) {
    const [series, resetMonth] = await Promise.all([getSetting<string>('creditNoteSeries'), getSetting<number>('fyResetMonth')]);
    const fy = fyLabel(new Date(), Number(resetMonth));
    await prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx, 'creditNote', series, fy);
      await tx.creditNote.create({ data: { invoiceId: a.entityId, amount: Number(a.payload.amount), reason: String(a.payload.reason), approvalId: a.id, series: `${series}/${fy}/`, number } });
    });
  }
  await notify(a.requestedByUserId, 'credit_note_decided', approve ? 'Credit note approved' : 'Credit note rejected', remark ?? '', `/finance/leads/${a.leadId}`);
});

export async function invoicePdfKey(id: string) { const i = await prisma.invoice.findUnique({ where: { id } }); if (!i) throw notFound('Invoice'); return i.pdfKey ?? (await renderInvoicePdf(id)); }
export async function receiptPdfKey(id: string) { const r = await prisma.receipt.findUnique({ where: { id } }); if (!r?.pdfKey) throw notFound('Receipt'); return r.pdfKey; }

export async function publicInvoice(token: string) {
  const i = await prisma.invoice.findUnique({ where: { clientToken: token }, include: { payments: true, lead: { include: { client: true } } } });
  if (!i || i.status === 'draft') throw notFound('Invoice');
  return { fullNumber: i.fullNumber, issueDate: i.issueDate, total: i.total, subtotal: i.subtotal, cgst: i.cgst, sgst: i.sgst, igst: i.igst, gstPct: i.gstPct, status: i.status, text: i.text, paid: i.payments.reduce((a, p) => a + p.amount, 0), clientName: i.lead.client.name, company: (await getSetting<any>('branding'))?.companyName, hasPdf: !!i.pdfKey };
}
export async function publicInvoicePdfKey(token: string) { const i = await prisma.invoice.findUnique({ where: { clientToken: token } }); if (!i || i.status === 'draft') throw notFound('Invoice'); return i.pdfKey ?? (await renderInvoicePdf(i.id)); }
export async function publicReceipt(token: string) {
  const r = await prisma.receipt.findUnique({ where: { clientToken: token }, include: { payment: { include: { invoice: { include: { lead: { include: { client: true } } } } } } } });
  if (!r) throw notFound('Receipt');
  return { fullNumber: r.fullNumber, text: r.text, amount: r.payment.amount, paidOn: r.payment.paidOn, invoiceNumber: r.payment.invoice.fullNumber, clientName: r.payment.invoice.lead.client.name, company: (await getSetting<any>('branding'))?.companyName, hasPdf: !!r.pdfKey };
}
export async function publicReceiptPdfKey(token: string) { const r = await prisma.receipt.findUnique({ where: { clientToken: token } }); if (!r?.pdfKey) throw notFound('Receipt'); return r.pdfKey; }
