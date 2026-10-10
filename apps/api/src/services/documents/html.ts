import { getSetting } from '../../lib/settings.js';
import { prisma } from '../../lib/db.js';
import { renderTemplate } from '../../lib/template.js';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** Branded HTML for quote / invoice / receipt / mom. Used by both mock and Playwright renderer. */
export async function renderDocumentHtml(templateKey: string, data: Record<string, any>) {
  const b = await getSetting<any>('branding');
  const blocks = Object.fromEntries((await prisma.template.findMany({ where: { channel: 'pdf', active: true } })).map((t) => [t.key, renderTemplate(t.body, { company: b?.companyName ?? '' })]));
  data = { ...data, blocks };
  const watermark = data.watermark ? `<div class="wm">${esc(data.watermark)}</div>` : '';
  const body = templateKey === 'quote' ? quoteBody(data) : templateKey === 'invoice' ? invoiceBody(data) : templateKey === 'receipt' ? receiptBody(data) : preBody(data);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.title ?? templateKey)}</title>
<style>
body{font-family:Inter,Arial,sans-serif;color:#1a1a1a;margin:0;padding:32px;font-size:13px;position:relative}
h1{font-size:20px;margin:0 0 4px;color:${esc(b?.colors?.primary ?? '#1F3A5F')}} h2{font-size:14px;margin:18px 0 6px}
table{width:100%;border-collapse:collapse;margin:8px 0} th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:12px} th{background:#f5f6f8}
.right{text-align:right}.muted{color:#666}.hdr{display:flex;justify-content:space-between;border-bottom:2px solid ${esc(b?.colors?.primary ?? '#1F3A5F')};padding-bottom:12px;margin-bottom:16px}
.wm{position:absolute;top:40%;left:10%;font-size:64px;color:rgba(220,38,38,.18);transform:rotate(-25deg);font-weight:700;pointer-events:none}
pre{white-space:pre-wrap;font-family:inherit}
</style></head><body>${watermark}
<div class="hdr"><div><h1>${esc(b?.companyName)}</h1><div class="muted">${esc(b?.address)}<br>GSTIN ${esc(b?.gstin)} · ${esc(b?.phone)} · ${esc(b?.email)}</div></div>
<div class="right"><strong>${esc(data.title ?? templateKey.toUpperCase())}</strong><br><span class="muted">${esc(data.docNumber ?? '')}<br>${esc(data.date ?? '')}</span></div></div>
${body}</body></html>`;
}

function quoteBody(d: any) {
  const q = d.quote;
  const intro = d.blocks?.quote_intro ? `<p class="muted">${esc(d.blocks.quote_intro)}</p>` : '';
  const rooms = (q.data.rooms ?? []).map((r: any) => `<h2>${esc(r.name)}</h2><table><tr><th>Item</th><th>Qty</th><th>Unit</th><th class="right">Rate</th><th class="right">Amount</th></tr>${r.items.map((i: any) => `<tr><td>${esc(i.label)}${i.rateOverridden ? ' <span class="muted">(rate overridden)</span>' : ''}</td><td>${i.qty}</td><td>${esc(i.unit)}</td><td class="right">${inr(i.rate)}</td><td class="right">${inr(i.amount)}</td></tr>`).join('')}</table>`).join('');
  const services = (q.data.services ?? []).map((s: any) => `<tr><td>${esc(s.label)}</td><td>${s.mode === 'pct' ? s.value + '%' : 'fixed'}</td><td class="right">${inr(s.amount)}</td></tr>`).join('');
  return `${intro}<p><strong>Client:</strong> ${esc(d.clientName)} · <strong>Version:</strong> ${q.versionNo} · <strong>Valid for:</strong> ${q.validityDays} days</p>
<p>${esc(q.data.propertyType)} · ${q.data.carpetAreaSqft} sqft · ${esc(q.data.locality)} · ${esc(q.data.package)} package · ${esc(q.data.projectType)}</p>
<table><tr><td>Base (${q.data.carpetAreaSqft} sqft × package rate)</td><td class="right">${inr(d.totals.base)}</td></tr></table>
${rooms}
<h2>Services</h2><table><tr><th>Service</th><th>Mode</th><th class="right">Amount</th></tr>${services}</table>
<h2>Totals</h2><table>
<tr><td>Rooms total</td><td class="right">${inr(d.totals.roomsTotal)}</td></tr><tr><td>Services</td><td class="right">${inr(d.totals.servicesTotal)}</td></tr>
<tr><td>Contingency (${q.data.contingencyPct}%)</td><td class="right">${inr(d.totals.contingency)}</td></tr><tr><td>Discount</td><td class="right">−${inr(d.totals.discount)}</td></tr>
<tr><th>Subtotal (without GST)</th><th class="right">${inr(q.subtotal)}</th></tr><tr><td>GST ${q.gstPct}%</td><td class="right">${inr(q.gstAmount)}</td></tr>
<tr><th>Total (with GST)</th><th class="right">${inr(q.total)}</th></tr></table>
<h2>Payment schedule</h2><table><tr><th>Milestone</th><th>%</th><th class="right">Amount</th><th>Trigger</th></tr>${(q.paymentSchedule ?? []).map((m: any) => `<tr><td>${esc(m.name)}</td><td>${m.pct}%</td><td class="right">${inr(m.amount)}</td><td>${esc(m.trigger)}</td></tr>`).join('')}</table>
<h2>Inclusions</h2><pre>${esc(d.inclusionsText)}</pre><h2>Exclusions</h2><pre>${esc(d.exclusionsText)}</pre><h2>Terms</h2><pre>${esc(d.termsText)}</pre>`;
}
function invoiceBody(d: any) {
  const inv = d.invoice;
  return `<table><tr><td><strong>Bill to</strong><br>${esc(d.billing.legalName)}<br>${esc(d.billing.billingAddress)}<br>${esc(d.billing.state)}<br>GSTIN ${esc(d.billing.gstin ?? '-')}</td><td><strong>Site</strong><br>${esc(d.billing.siteAddress)}<br>Contact ${esc(d.billing.contactName)}</td></tr></table>
<table><tr><th>Description</th><th>HSN/SAC</th><th class="right">Amount</th></tr>${inv.lines.map((l: any) => `<tr><td>${esc(l.description)}</td><td>${esc(inv.hsnSac)}</td><td class="right">${inr(l.amount)}</td></tr>`).join('')}
<tr><td colspan="2" class="right">Subtotal</td><td class="right">${inr(inv.subtotal)}</td></tr>
${inv.igst ? `<tr><td colspan="2" class="right">IGST ${inv.gstPct}%</td><td class="right">${inr(inv.igst)}</td></tr>` : `<tr><td colspan="2" class="right">CGST ${inv.gstPct / 2}%</td><td class="right">${inr(inv.cgst)}</td></tr><tr><td colspan="2" class="right">SGST ${inv.gstPct / 2}%</td><td class="right">${inr(inv.sgst)}</td></tr>`}
<tr><th colspan="2" class="right">Total</th><th class="right">${inr(inv.total)}</th></tr></table><p class="muted">Place of supply: ${esc(inv.placeOfSupplyState)}</p>${d.blocks?.invoice_footer ? `<p class="muted">${esc(d.blocks.invoice_footer)}</p>` : ''}`;
}
function receiptBody(d: any) {
  return `<p>Received with thanks from <strong>${esc(d.clientName)}</strong> the sum of <strong>${inr(d.amount)}</strong> by ${esc(d.mode)} ${d.reference ? '(' + esc(d.reference) + ')' : ''} on ${esc(d.paidOn)} against invoice ${esc(d.invoiceNumber)}.</p>${d.blocks?.receipt_footer ? `<p class="muted">${esc(d.blocks.receipt_footer)}</p>` : ''}`;
}
function preBody(d: any) { return `<pre>${esc(d.text)}</pre>`; }
