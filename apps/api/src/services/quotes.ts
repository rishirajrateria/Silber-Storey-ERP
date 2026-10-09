import { prisma } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import type { AuthUser } from '../plugins/auth.js';
import { computeQuote, QuoteDataSchema, PaymentScheduleSchema, scheduleSumsTo100, STAGES, type QuoteData, type PaymentSchedule } from '@app/shared';
import { getSetting } from '../lib/settings.js';
import { newToken } from '../lib/tokens.js';
import { pdf } from '../integrations/index.js';
import { createApproval, registerApprovalHandler } from './approvals.js';
import { sendToClient3 } from './messaging.js';
import { notify } from './notifications.js';
import { setEngineerStatusByKey, setStage } from './stage.js';
import { enqueue } from '../jobs/queue.js';
import { config } from '../config.js';
import { rt } from '../realtime.js';

const r2 = (n: number) => Math.round(n * 100) / 100;

async function engineerLead(u: AuthUser, leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { client: true, billing: true, quote: { include: { versions: { orderBy: { versionNo: 'desc' } } } } } });
  if (!lead) throw notFound('Lead');
  if (u.role === 'engineer' && lead.engineerUserId !== u.id) throw forbidden('Not your lead');
  if (u.role === 'finance') throw forbidden('Finance cannot access quotes');
  return lead;
}

export async function getQuote(u: AuthUser, leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { quote: { include: { versions: { orderBy: { versionNo: 'asc' } } } } } });
  if (!lead) throw notFound('Lead');
  if (u.role === 'engineer' && lead.engineerUserId !== u.id) throw forbidden('Not your lead');
  if (!lead.quote) return null;
  if (u.role === 'finance') {
    // Rule 9.9: finance reads totals + schedule only
    return { id: lead.quote.id, currentVersionNo: lead.quote.currentVersionNo, finalVersionId: lead.quote.finalVersionId, versions: lead.quote.versions.filter((v) => v.isFinal).map((v) => ({ id: v.id, versionNo: v.versionNo, subtotal: v.subtotal, gstPct: v.gstPct, gstAmount: v.gstAmount, total: v.total, paymentSchedule: v.paymentSchedule, isFinal: v.isFinal, clientAcceptedAt: v.clientAcceptedAt, approvalStatus: v.approvalStatus })) };
  }
  return lead.quote;
}

function diff(prev: any, next: any): Record<string, { from: unknown; to: unknown }> {
  if (!prev) return {};
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) { if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) out[k] = { from: prev[k], to: next[k] }; }
  return out;
}

export function quoteText(v: { versionNo: number; data: QuoteData; subtotal: number; gstPct: number; gstAmount: number; total: number; paymentSchedule: any[]; validityDays: number }, totals: any, texts: { inclusionsText: string; exclusionsText: string; termsText: string }, clientName: string) {
  const d = v.data;
  const rooms = d.rooms.map((r) => `  ${r.name}\n` + r.items.map((i) => `    - ${i.label}: ${i.qty} ${i.unit} × ${i.rate} = ${i.amount}${i.rateOverridden ? ' (override: ' + (i.overrideRemark ?? '') + ')' : ''}`).join('\n')).join('\n');
  return `QUOTE v${v.versionNo} for ${clientName}\n${d.propertyType} · ${d.carpetAreaSqft} sqft · ${d.locality} · ${d.package} package · ${d.projectType} · ${d.possession}\n\nBase: ${totals.base}\nRooms:\n${rooms}\nServices:\n${d.services.map((s) => `  - ${s.label} (${s.mode === 'pct' ? s.value + '%' : 'fixed'}): ${s.amount}`).join('\n')}\nContingency ${d.contingencyPct}%: ${totals.contingency}\nDiscount: ${totals.discount}\nSubtotal (without GST): ${v.subtotal}\nGST ${v.gstPct}%: ${v.gstAmount}\nTotal (with GST): ${v.total}\n\nPayment schedule:\n${v.paymentSchedule.map((m: any) => `  - ${m.name}: ${m.pct}% = ${m.amount} (${m.trigger})`).join('\n')}\nValidity: ${v.validityDays} days\n\nInclusions:\n${texts.inclusionsText}\n\nExclusions:\n${texts.exclusionsText}\n\nTerms:\n${texts.termsText}\n`;
}

/* Rule 9.7: create immutable version */
export async function createVersion(u: AuthUser, leadId: string, input: { data: unknown; paymentSchedule: unknown; approvalRequired?: boolean; isFinal?: boolean }) {
  const lead = await engineerLead(u, leadId);
  if (!lead.transferredToEngineerAt) throw conflict('NOT_TRANSFERRED', 'Lead not with engineer');
  if (STAGES.indexOf(lead.stage) >= STAGES.indexOf('advance_paid')) throw conflict('LOCKED', 'Quote changes not allowed after advance paid');
  const data = QuoteDataSchema.parse(input.data);
  const schedule = PaymentScheduleSchema.parse(input.paymentSchedule) as PaymentSchedule;
  if (!scheduleSumsTo100(schedule)) throw badRequest('Payment schedule must sum to 100%');
  const [rateCard, gstPct, validityDays, inclusionsText, exclusionsText, termsText] = await Promise.all([getSetting<any>('rateCard'), getSetting<number>('gstPct'), getSetting<number>('quoteValidityDays'), getSetting<string>('inclusionsText'), getSetting<string>('exclusionsText'), getSetting<string>('termsText')]);
  const totals = computeQuote(data, Number(rateCard.packages[data.package] ?? 0), Number(gstPct));
  const paymentSchedule = schedule.map((m) => ({ ...m, amount: r2((totals.total * m.pct) / 100) }));
  const versionNo = (lead.quote?.currentVersionNo ?? 0) + 1;
  const isFinal = !!input.isFinal;
  const approvalRequired = versionNo === 1 || isFinal ? true : !!input.approvalRequired;
  const prev = lead.quote?.versions[0];
  const base = { versionNo, data: totals.data, subtotal: totals.subtotal, discount: totals.discount, gstPct: Number(gstPct), gstAmount: totals.gstAmount, total: totals.total, paymentSchedule, validityDays: Number(validityDays) };
  const text = quoteText(base, totals, { inclusionsText, exclusionsText, termsText }, lead.client.name ?? lead.client.phone);
  const version = await prisma.$transaction(async (tx) => {
    const quote = lead.quote ? await tx.quote.update({ where: { id: lead.quote.id }, data: { currentVersionNo: versionNo } }) : await tx.quote.create({ data: { leadId, currentVersionNo: versionNo } });
    const v = await tx.quoteVersion.create({ data: { quoteId: quote.id, ...base, data: totals.data as any, paymentSchedule: paymentSchedule as any, approvalRequired, approvalStatus: approvalRequired ? 'pending' : 'not_required', isFinal, clientToken: newToken(), text, diffFromPrevious: diff(prev ? { ...(prev.data as any), subtotal: prev.subtotal, total: prev.total, paymentSchedule: prev.paymentSchedule } : null, { ...totals.data, subtotal: totals.subtotal, total: totals.total, paymentSchedule }) as any, createdByUserId: u.id } });
    if (isFinal) await tx.quote.update({ where: { id: quote.id }, data: { finalVersionId: v.id } });
    return v;
  });
  const pdfKey = await renderQuotePdf(version.id);
  await prisma.quoteVersion.update({ where: { id: version.id }, data: { pdfKey } });
  await enqueue('embed_document', { docType: 'quote', docId: version.id, leadId, clientId: lead.clientId, text, meta: { versionNo } });
  if (versionNo === 1) await setStage(leadId, 'quote_v1', u.id);
  if (approvalRequired) {
    await createApproval({ type: 'quote_version', entityType: 'QuoteVersion', entityId: version.id, leadId, requestedByUserId: u.id, payload: { versionNo, total: totals.total, isFinal } });
    await setEngineerStatusByKey(leadId, 'quote_waiting_approval', u.id);
  }
  rt.lead(leadId, { type: 'quote', versionId: version.id });
  return { ...version, pdfKey };
}

export async function renderQuotePdf(versionId: string) {
  const v = await prisma.quoteVersion.findUniqueOrThrow({ where: { id: versionId }, include: { quote: { include: { lead: { include: { client: true } } } } } });
  const [inclusionsText, exclusionsText, termsText, rateCard] = await Promise.all([getSetting<string>('inclusionsText'), getSetting<string>('exclusionsText'), getSetting<string>('termsText'), getSetting<any>('rateCard')]);
  const d = v.data as QuoteData;
  const totals = computeQuote(d, Number(rateCard.packages[d.package] ?? 0), v.gstPct);
  const key = `quotes/${v.quote.leadId}/v${v.versionNo}-${Date.now()}.pdf`;
  await pdf.render('quote', { title: `Quotation v${v.versionNo}`, docNumber: `Q-${v.quote.leadId.slice(-6).toUpperCase()}-${v.versionNo}`, date: v.createdAt.toDateString(), quote: v, totals, clientName: v.quote.lead.client.name ?? v.quote.lead.client.phone, inclusionsText, exclusionsText, termsText, watermark: v.approvalRequired && v.approvalStatus !== 'approved' ? 'DRAFT – NOT APPROVED' : undefined }, key);
  return key;
}

async function ownedVersion(u: AuthUser, vid: string) {
  const v = await prisma.quoteVersion.findUnique({ where: { id: vid }, include: { quote: { include: { lead: { include: { client: true } } } } } });
  if (!v) throw notFound('Quote version');
  if (u.role === 'engineer' && v.quote.lead.engineerUserId !== u.id) throw forbidden('Not your lead');
  if (u.role === 'finance') throw forbidden('Finance cannot access quote versions');
  return v;
}
export { ownedVersion };

export async function markFinal(u: AuthUser, vid: string) {
  const v = await ownedVersion(u, vid);
  if (v.isFinal) return v;
  // Rule 9.7: isFinal ⇒ approvalRequired. Versions are immutable, so if the version wasn't created with approval it must go through approval now.
  const approvalRequired = true;
  const approvalStatus = v.approvalStatus === 'approved' ? 'approved' : 'pending';
  const upd = await prisma.$transaction(async (tx) => {
    const x = await tx.quoteVersion.update({ where: { id: vid }, data: { isFinal: true, approvalRequired, approvalStatus } });
    await tx.quote.update({ where: { id: v.quoteId }, data: { finalVersionId: vid } });
    return x;
  });
  if (approvalStatus === 'pending') {
    await createApproval({ type: 'quote_version', entityType: 'QuoteVersion', entityId: vid, leadId: v.quote.leadId, requestedByUserId: u.id, payload: { versionNo: v.versionNo, total: v.total, isFinal: true } }).catch(() => null);
    await setEngineerStatusByKey(v.quote.leadId, 'quote_waiting_approval', u.id);
  }
  const pdfKey = await renderQuotePdf(vid);
  return prisma.quoteVersion.update({ where: { id: vid }, data: { pdfKey } });
}

export async function requestApproval(u: AuthUser, vid: string) {
  const v = await ownedVersion(u, vid);
  if (v.approvalStatus === 'approved') throw conflict('ALREADY_APPROVED', 'Already approved');
  await prisma.quoteVersion.update({ where: { id: vid }, data: { approvalRequired: true, approvalStatus: 'pending' } });
  const a = await createApproval({ type: 'quote_version', entityType: 'QuoteVersion', entityId: vid, leadId: v.quote.leadId, requestedByUserId: u.id, payload: { versionNo: v.versionNo, total: v.total, isFinal: v.isFinal } });
  await setEngineerStatusByKey(v.quote.leadId, 'quote_waiting_approval', u.id);
  return a;
}

registerApprovalHandler('quote_version', async (a, approve, u, remark) => {
  const v = await prisma.quoteVersion.findUnique({ where: { id: a.entityId }, include: { quote: { include: { lead: true } } } });
  if (!v) return;
  await prisma.quoteVersion.update({ where: { id: v.id }, data: { approvalStatus: approve ? 'approved' : 'rejected', approvedByUserId: approve ? u.id : null, approvedAt: approve ? new Date() : null, approvalRemark: remark } });
  const pdfKey = await renderQuotePdf(v.id);
  await prisma.quoteVersion.update({ where: { id: v.id }, data: { pdfKey } });
  if (approve) await setStage(v.quote.leadId, 'admin_approved', u.id);
  else await setEngineerStatusByKey(v.quote.leadId, 'asked_quote', u.id, `Quote v${v.versionNo} rejected: ${remark ?? ''}`);
  if (v.quote.lead.engineerUserId) await notify(v.quote.lead.engineerUserId, approve ? 'quote_approved' : 'quote_rejected', approve ? `Quote v${v.versionNo} approved` : `Quote v${v.versionNo} rejected`, remark ?? '', `/engineer/leads/${v.quote.leadId}?tab=quote`);
});

/* Rule 9.7: send */
export async function send(u: AuthUser, vid: string) {
  const v = await ownedVersion(u, vid);
  if (v.approvalRequired && v.approvalStatus !== 'approved') throw conflict('APPROVAL_REQUIRED', 'Quote needs admin approval before sending');
  const lead = v.quote.lead;
  const sentBefore = await prisma.quoteVersion.count({ where: { quoteId: v.quoteId, sentToClientAt: { not: null } } });
  const upd = await prisma.quoteVersion.update({ where: { id: vid }, data: { sentToClientAt: v.sentToClientAt ?? new Date() } });
  const pdfKey = v.pdfKey ?? (await renderQuotePdf(vid));
  await sendToClient3({ leadId: lead.id, clientId: lead.clientId, client: lead.client, templateKey: 'quote_link', vars: { client_name: lead.client.name ?? 'there', quote_link: `${config.appUrl}/p/quote/${v.clientToken}`, quote_total: v.total }, attachmentKey: pdfKey, byUserId: u.id });
  await setEngineerStatusByKey(lead.id, sentBefore === 0 ? 'quote_sent' : 'multiple_quotes_sent', u.id);
  await setStage(lead.id, 'quote_sent', u.id);
  return upd;
}

async function acceptVersion(v: { id: string; quote: { leadId: string; lead: { engineerUserId: string | null } } }, byUserId: string) {
  await prisma.quoteVersion.update({ where: { id: v.id }, data: { clientAcceptedAt: new Date() } });
  await setEngineerStatusByKey(v.quote.leadId, 'quote_approved_payment', byUserId);
  await setStage(v.quote.leadId, 'client_accepted_final', byUserId);
}
export async function markAccepted(u: AuthUser, vid: string) {
  const v = await ownedVersion(u, vid);
  if (v.clientAcceptedAt) return v;
  await acceptVersion(v, u.id);
  return prisma.quoteVersion.findUnique({ where: { id: vid } });
}

export async function versionDiff(u: AuthUser, vid: string) { const v = await ownedVersion(u, vid); return v.diffFromPrevious; }

export async function pdfKeyFor(u: AuthUser, vid: string) {
  const v = await prisma.quoteVersion.findUnique({ where: { id: vid }, include: { quote: { include: { lead: true } } } });
  if (!v) throw notFound('Quote version');
  if (u.role === 'engineer' && v.quote.lead.engineerUserId !== u.id) throw forbidden('Not your lead');
  if (u.role === 'finance' && !v.isFinal) throw forbidden('Finance may only view the final quote PDF');
  return v.pdfKey ?? (await renderQuotePdf(vid));
}

/* Rule 9.8: push to finance */
export async function pushToFinance(u: AuthUser, leadId: string) {
  const lead = await engineerLead(u, leadId);
  const final = lead.quote?.finalVersionId ? lead.quote.versions.find((v) => v.id === lead.quote!.finalVersionId) : null;
  if (!final) throw conflict('NO_FINAL_QUOTE', 'Mark a quote version as final first');
  if (final.approvalStatus !== 'approved') throw conflict('FINAL_NOT_APPROVED', 'Final version is not approved');
  if (!final.clientAcceptedAt) throw conflict('NOT_ACCEPTED', 'Client has not accepted the final quote');
  const b = lead.billing;
  if (!b || !b.legalName || !b.billingAddress || !b.state || !b.siteAddress || !b.contactName || !b.contactPhone || !b.contactEmail) throw conflict('BILLING_INCOMPLETE', 'Billing details are incomplete');
  const schedule = final.paymentSchedule as Array<{ name: string; pct: number; amount: number }>;
  const finance = await prisma.user.findFirst({ where: { role: 'finance', active: true } });
  await prisma.$transaction(async (tx) => {
    const old = await tx.paymentPipeline.findUnique({ where: { leadId } });
    if (old) await tx.paymentPipeline.delete({ where: { id: old.id } });
    const p = await tx.paymentPipeline.create({ data: { leadId, quoteVersionId: final.id } });
    for (let i = 0; i < schedule.length; i++) await tx.milestone.create({ data: { pipelineId: p.id, order: i + 1, name: schedule[i].name, pct: schedule[i].pct, amount: r2((final.total * schedule[i].pct) / 100) } });
    await tx.lead.update({ where: { id: leadId }, data: { pushedToFinanceAt: new Date(), financeUserId: finance?.id } });
    await setStage(leadId, 'pushed_to_finance', u.id, tx);
  });
  await setEngineerStatusByKey(leadId, 'pushed_to_finance', u.id);
  if (finance) await notify(finance.id, 'pushed_to_finance', 'Lead pushed to finance', lead.client.name ?? lead.client.phone, `/finance/leads/${leadId}`);
  return prisma.lead.findUnique({ where: { id: leadId }, include: { pipeline: { include: { milestones: true } } } });
}

/* public quote page */
export async function publicQuote(token: string) {
  const v = await prisma.quoteVersion.findUnique({ where: { clientToken: token }, include: { quote: { include: { lead: { include: { client: true } } } } } });
  if (!v || !v.sentToClientAt) throw notFound('Quote');
  if (Date.now() > v.createdAt.getTime() + v.validityDays * 86400000 && !v.clientAcceptedAt) throw conflict('EXPIRED', 'This quote link has expired');
  return { versionNo: v.versionNo, total: v.total, subtotal: v.subtotal, gstAmount: v.gstAmount, gstPct: v.gstPct, text: v.text, paymentSchedule: v.paymentSchedule, validityDays: v.validityDays, createdAt: v.createdAt, clientAcceptedAt: v.clientAcceptedAt, clientChangeRequest: v.clientChangeRequest, isFinal: v.isFinal, clientName: v.quote.lead.client.name, company: (await getSetting<any>('branding'))?.companyName, hasPdf: !!v.pdfKey };
}
export async function publicQuotePdfKey(token: string) {
  const v = await prisma.quoteVersion.findUnique({ where: { clientToken: token } });
  if (!v || !v.sentToClientAt) throw notFound('Quote');
  return v.pdfKey ?? (await renderQuotePdf(v.id));
}
export async function publicQuoteAccept(token: string) {
  const v = await prisma.quoteVersion.findUnique({ where: { clientToken: token }, include: { quote: { include: { lead: true } } } });
  if (!v || !v.sentToClientAt) throw notFound('Quote');
  if (Date.now() > v.createdAt.getTime() + v.validityDays * 86400000) throw conflict('EXPIRED', 'This quote link has expired');
  if (!v.clientAcceptedAt) {
    await acceptVersion(v, v.quote.lead.engineerUserId ?? v.createdByUserId);
    if (v.quote.lead.engineerUserId) await notify(v.quote.lead.engineerUserId, 'quote_accepted', `Client accepted quote v${v.versionNo}`, '', `/engineer/leads/${v.quote.leadId}?tab=quote`);
  }
  return { ok: true };
}
export async function publicQuoteRequestChanges(token: string, remark: string) {
  const v = await prisma.quoteVersion.findUnique({ where: { clientToken: token }, include: { quote: { include: { lead: true } } } });
  if (!v || !v.sentToClientAt) throw notFound('Quote');
  await prisma.quoteVersion.update({ where: { id: v.id }, data: { clientChangeRequest: remark } });
  if (v.quote.lead.engineerUserId) await notify(v.quote.lead.engineerUserId, 'quote_change_requested', `Client requested changes on v${v.versionNo}`, remark.slice(0, 200), `/engineer/leads/${v.quote.leadId}?tab=quote`);
  return { ok: true };
}
