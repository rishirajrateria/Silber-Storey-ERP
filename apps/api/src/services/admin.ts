import archiver from 'archiver';
import { PassThrough } from 'node:stream';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { storage, whatsapp } from '../integrations/index.js';
import { getAllSettings, setSetting } from '../lib/settings.js';
import type { AuthUser } from '../plugins/auth.js';
import { notify } from './notifications.js';

/* statuses */
export async function createStatus(dashboard: 'sales' | 'engineer', input: { key: string; label: string; order?: number; requiresFollowUp?: boolean; isFinal?: boolean }) {
  if (!/^[a-z0-9_]+$/.test(input.key)) throw badRequest('Key must be snake_case');
  return prisma.leadStatus.create({ data: { dashboard, key: input.key, label: input.label, order: input.order ?? 99, requiresFollowUp: !!input.requiresFollowUp, isFinal: !!input.isFinal } });
}
export async function patchStatus(id: string, input: { label?: string; order?: number; requiresFollowUp?: boolean; isFinal?: boolean; active?: boolean }) {
  const s = await prisma.leadStatus.findUnique({ where: { id } }); if (!s) throw notFound('Status');
  if (s.isSystem && (input.active === false)) throw conflict('SYSTEM_STATUS', 'System statuses cannot be deactivated');
  return prisma.leadStatus.update({ where: { id }, data: input });
}
export async function deleteStatus(id: string) {
  const s = await prisma.leadStatus.findUnique({ where: { id } }); if (!s) throw notFound('Status');
  if (s.isSystem) throw conflict('SYSTEM_STATUS', 'System statuses cannot be deleted');
  const inUse = await prisma.lead.count({ where: { OR: [{ salesStatusId: id }, { engineerStatusId: id }] } });
  if (inUse) return prisma.leadStatus.update({ where: { id }, data: { active: false } });
  return prisma.leadStatus.delete({ where: { id } });
}

/* settings */
export const getSettings = getAllSettings;
export async function putSettings(input: Record<string, unknown>) { for (const [k, v] of Object.entries(input)) await setSetting(k, v); return getAllSettings(); }

/* templates */
export async function submitWhatsAppTemplate(id: string) {
  const t = await prisma.template.findUnique({ where: { id } }); if (!t || t.channel !== 'whatsapp') throw badRequest('Not a WhatsApp template');
  const r = await whatsapp.submitTemplate({ key: t.key, body: t.body });
  return prisma.template.update({ where: { id }, data: { providerStatus: r.providerStatus } });
}

/* clients */
export async function deleteClient(id: string, confirmation: string) {
  const c = await prisma.client.findUnique({ where: { id } }); if (!c) throw notFound('Client');
  if (confirmation !== c.phone) throw badRequest('Type the client phone to confirm');
  return prisma.client.update({ where: { id }, data: { deletedAt: new Date() } });
}

/* lead admin ops */
export async function archiveLead(id: string) { return prisma.lead.update({ where: { id }, data: { archived: true } }); }
export async function deleteLead(id: string) {
  // Rule 9.15: hard delete lead, never the Client
  const l = await prisma.lead.findUnique({ where: { id } }); if (!l) throw notFound('Lead');
  await prisma.lead.delete({ where: { id } });
  return { ok: true };
}
export async function closeProject(u: AuthUser, id: string, keepRecordings: boolean) {
  const lead = await prisma.lead.findUnique({ where: { id }, include: { meetings: { include: { recordings: true } } } }); if (!lead) throw notFound('Lead');
  if (!keepRecordings) for (const m of lead.meetings) for (const r of m.recordings) { if (!r.deletedAt) { await storage.delete(r.storageKey).catch(() => null); await prisma.recording.update({ where: { id: r.id }, data: { deletedAt: new Date() } }); } }
  return prisma.lead.update({ where: { id }, data: { projectClosedAt: new Date(), recordingsKept: keepRecordings, archived: true } });
}

/* export zip: text/JSON of everything for one lead */
export async function exportLeadZip(id: string) {
  const lead = await prisma.lead.findUnique({ where: { id }, include: { client: true, billing: true, statusHistory: true, followUps: true, meetings: { include: { transcript: true, mom: { include: { objections: true } }, recordings: true, notes: true } }, notes: true, files: true, quote: { include: { versions: true } }, pipeline: { include: { milestones: { include: { invoice: { include: { payments: { include: { receipt: true } } } } } } } }, messages: true, handover: true, approvals: true, delays: true } });
  if (!lead) throw notFound('Lead');
  const zip = archiver('zip', { zlib: { level: 6 } });
  const out = new PassThrough();
  zip.pipe(out);
  zip.append(JSON.stringify(lead, null, 2), { name: 'lead.json' });
  for (const m of lead.meetings) { if (m.transcript) zip.append(m.transcript.text, { name: `meetings/${m.id}/transcript.txt` }); if (m.mom) zip.append(m.mom.text, { name: `meetings/${m.id}/mom.txt` }); }
  for (const v of lead.quote?.versions ?? []) { zip.append(v.text, { name: `quotes/v${v.versionNo}.txt` }); if (v.pdfKey) { const b = await storage.get(v.pdfKey).catch(() => null); if (b) zip.append(b, { name: `quotes/v${v.versionNo}.pdf.html` }); } }
  for (const m of lead.pipeline?.milestones ?? []) if (m.invoice) { zip.append(m.invoice.text, { name: `invoices/${(m.invoice.fullNumber ?? m.invoice.id).replace(/\//g, '-')}.txt` }); for (const p of m.invoice.payments) if (p.receipt) zip.append(p.receipt.text, { name: `receipts/${p.receipt.fullNumber.replace(/\//g, '-')}.txt` }); }
  for (const f of lead.files) { const b = await storage.get(f.storageKey).catch(() => null); if (b) zip.append(b, { name: `files/${f.name}` }); }
  await zip.finalize();
  return out;
}

export async function fullExport() {
  const tables = ['user', 'client', 'lead', 'billingDetails', 'leadStatus', 'statusHistory', 'followUp', 'leadSource', 'meeting', 'recording', 'transcript', 'minutesOfMeeting', 'objection', 'note', 'leadFile', 'quote', 'quoteVersion', 'paymentPipeline', 'milestone', 'invoice', 'payment', 'receipt', 'creditNote', 'approval', 'message', 'template', 'handover', 'delay', 'delayRule', 'notificationRule', 'setting', 'reportSchedule', 'auditLog'] as const;
  const out: Record<string, unknown> = {};
  for (const t of tables) out[t] = await (prisma as any)[t].findMany();
  return out;
}
export async function runBackup() {
  const data = await fullExport();
  const key = `backups/${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const r = await storage.putStream(key, Buffer.from(JSON.stringify(data)), 'application/json');
  return { key, bytes: r.bytes };
}

export async function analytics(dashboard: string, from?: string, to?: string) {
  const { report, stats } = await import('./reports.js');
  const keys = dashboard === 'sales' ? ['leads_by_source', 'leads_by_status', 'contact_rate', 'qualification_rate'] : dashboard === 'engineer' ? ['meetings_summary', 'meeting_to_quote', 'quote_to_acceptance'] : dashboard === 'finance' ? ['invoice_to_payment', 'outstanding_ageing', 'collections_by_month'] : ['leads_by_status', 'sla_breaches', 'user_performance'];
  const out: Record<string, unknown> = { stats: await stats(dashboard) };
  for (const k of keys) out[k] = await report(k, { dashboard, from, to });
  return out;
}

export async function requestUser(u: AuthUser, input: { email: string; name: string; role: string }) {
  const { createApproval } = await import('./approvals.js');
  return createApproval({ type: 'new_user', entityType: 'User', entityId: input.email, requestedByUserId: u.id, payload: input });
}
export { notify };
