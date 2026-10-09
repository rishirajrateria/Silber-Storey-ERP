import { prisma } from '../lib/db.js';
import { badRequest } from '../lib/errors.js';
import { email } from '../integrations/index.js';
import { REPORT_KEYS } from '@app/shared';

type Row = Record<string, string | number | null>;
const csv = (rows: Row[]) => { if (!rows.length) return ''; const cols = Object.keys(rows[0]); return [cols.join(','), ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? '')).join(','))].join('\n'); };
const days = (a: Date | null | undefined, b: Date | null | undefined) => (a && b ? +((b.getTime() - a.getTime()) / 86400000).toFixed(2) : null);
const pct = (n: number, d: number) => (d ? +((n / d) * 100).toFixed(1) : 0);

export async function report(key: string, opts: { dashboard?: string; from?: string; to?: string; userId?: string }): Promise<Row[]> {
  if (!(REPORT_KEYS as readonly string[]).includes(key)) throw badRequest('Unknown report');
  const range = { gte: opts.from ? new Date(opts.from) : new Date(0), lte: opts.to ? new Date(opts.to) : new Date() };
  const scope: any = opts.userId ? (opts.dashboard === 'sales' ? { salesUserId: opts.userId } : opts.dashboard === 'engineer' ? { engineerUserId: opts.userId } : {}) : {};
  const leads = await prisma.lead.findMany({ where: { leadDate: range, ...scope }, include: { salesStatus: true, engineerStatus: true, statusHistory: true, meetings: true, quote: { include: { versions: true } }, invoices: { include: { payments: true } }, client: true } });
  const group = (fn: (l: (typeof leads)[number]) => string) => { const m = new Map<string, number>(); for (const l of leads) m.set(fn(l), (m.get(fn(l)) ?? 0) + 1); return [...m].map(([k, count]) => ({ key: k, count })); };
  switch (key) {
    case 'leads_by_source': return group((l) => l.source);
    case 'leads_by_status': return group((l) => (l.engineerStatus?.label ? `engineer:${l.engineerStatus.label}` : `sales:${l.salesStatus.label}`));
    case 'contact_rate': { const c = leads.filter((l) => l.salesStatus.key !== 'no_status').length; return [{ leads: leads.length, contacted: c, rate_pct: pct(c, leads.length) }]; }
    case 'qualification_rate': { const q = leads.filter((l) => l.transferredToEngineerAt).length; return [{ leads: leads.length, transferred: q, rate_pct: pct(q, leads.length) }]; }
    case 'meetings_summary': { const ms = leads.flatMap((l) => l.meetings); const by = (s: string) => ms.filter((m) => m.status === s).length; return [{ total: ms.length, completed: by('completed'), no_show: by('no_show'), cancelled: by('cancelled'), avg_duration_min: ms.length ? +(ms.reduce((a, m) => a + (m.durationSec ?? 0), 0) / ms.length / 60).toFixed(1) : 0 }]; }
    case 'meeting_to_quote': return leads.filter((l) => l.quote).map((l) => ({ lead: l.client.name ?? l.client.phone, meeting_done: l.meetings.find((m) => m.status === 'completed')?.endAt?.toISOString() ?? null, quote_v1: l.quote!.versions[0]?.createdAt.toISOString() ?? null, days: days(l.meetings.find((m) => m.status === 'completed')?.endAt, l.quote!.versions[0]?.createdAt) }));
    case 'quote_to_acceptance': return leads.filter((l) => l.quote?.versions.some((v) => v.sentToClientAt)).map((l) => { const v = l.quote!.versions.find((x) => x.clientAcceptedAt) ?? l.quote!.versions.find((x) => x.sentToClientAt)!; return { lead: l.client.name ?? l.client.phone, sent: v.sentToClientAt?.toISOString() ?? null, accepted: v.clientAcceptedAt?.toISOString() ?? null, days: days(v.sentToClientAt, v.clientAcceptedAt), versions: l.quote!.versions.length }; });
    case 'approval_turnaround': { const as = await prisma.approval.findMany({ where: { createdAt: range, status: { not: 'pending' } } }); return as.map((a) => ({ type: a.type, requested: a.createdAt.toISOString(), decided: a.decidedAt?.toISOString() ?? null, hours: a.decidedAt ? +((a.decidedAt.getTime() - a.createdAt.getTime()) / 3600000).toFixed(1) : null })); }
    case 'invoice_to_payment': return leads.flatMap((l) => l.invoices.filter((i) => i.sentAt).map((i) => ({ invoice: i.fullNumber, sent: i.sentAt!.toISOString(), paid: i.status === 'paid' ? i.payments.at(-1)?.paidOn.toISOString() ?? null : null, days: i.status === 'paid' ? days(i.sentAt, i.payments.at(-1)?.paidOn) : null })));
    case 'outstanding_ageing': return leads.flatMap((l) => l.invoices.filter((i) => ['sent', 'partially_paid'].includes(i.status)).map((i) => { const paid = i.payments.reduce((a, p) => a + p.amount, 0); return { invoice: i.fullNumber, client: l.client.name ?? l.client.phone, outstanding: +(i.total - paid).toFixed(2), age_days: days(i.sentAt, new Date()) }; }));
    case 'sla_breaches': { const ds = await prisma.delay.findMany({ where: { breachedAt: range, ...(opts.dashboard ? { dashboard: opts.dashboard } : {}) } }); const m = new Map<string, number>(); for (const d of ds) m.set(`${d.dashboard}:${d.ruleKey}`, (m.get(`${d.dashboard}:${d.ruleKey}`) ?? 0) + 1); return [...m].map(([rule, count]) => ({ rule, count })); }
    case 'user_performance': { const users = await prisma.user.findMany({ where: { active: true } }); return users.map((u) => ({ user: u.name, role: u.role, leads: leads.filter((l) => l.salesUserId === u.id || l.engineerUserId === u.id).length, transferred: leads.filter((l) => l.salesUserId === u.id && l.transferredToEngineerAt).length, meetings_completed: leads.flatMap((l) => l.meetings).filter((m) => m.engineerUserId === u.id && m.status === 'completed').length, quotes_sent: leads.filter((l) => l.engineerUserId === u.id && l.quote?.versions.some((v) => v.sentToClientAt)).length })); }
    case 'collections_by_month': { const ps = await prisma.payment.findMany({ where: { paidOn: range } }); const m = new Map<string, number>(); for (const p of ps) { const k = p.paidOn.toISOString().slice(0, 7); m.set(k, (m.get(k) ?? 0) + p.amount); } return [...m].sort().map(([month, amount]) => ({ month, amount: +amount.toFixed(2) })); }
  }
  return [];
}
export const reportCsv = async (key: string, opts: Parameters<typeof report>[1]) => csv(await report(key, opts));

export async function stats(dashboard: string, userId?: string) {
  const scope: any = userId ? (dashboard === 'sales' ? { salesUserId: userId } : dashboard === 'engineer' ? { engineerUserId: userId } : {}) : {};
  const [total, open, transferred, meetings, quotes, invoiced, paid, delays, pendingApprovals] = await Promise.all([
    prisma.lead.count({ where: scope }),
    prisma.lead.count({ where: { ...scope, archived: false, lostReason: null, handoverCompletedAt: null } }),
    prisma.lead.count({ where: { ...scope, transferredToEngineerAt: { not: null } } }),
    prisma.meeting.count({ where: { status: 'completed', ...(userId && dashboard === 'engineer' ? { engineerUserId: userId } : {}) } }),
    prisma.quoteVersion.count({ where: { sentToClientAt: { not: null }, ...(userId && dashboard === 'engineer' ? { quote: { lead: { engineerUserId: userId } } } : {}) } }),
    prisma.invoice.aggregate({ _sum: { total: true }, where: { status: { not: 'draft' } } }),
    prisma.payment.aggregate({ _sum: { amount: true } }),
    prisma.delay.count({ where: { resolvedAt: null, ...(userId ? { userId } : {}) } }),
    prisma.approval.count({ where: { status: 'pending' } }),
  ]);
  return { total, open, transferred, meetings, quotes, invoiced: invoiced._sum.total ?? 0, collected: paid._sum.amount ?? 0, delays, pendingApprovals };
}

export async function runScheduledReports() {
  const now = new Date();
  const due = await prisma.reportSchedule.findMany({ where: { active: true } });
  for (const s of due) {
    const gap = s.frequency === 'daily' ? 1 : s.frequency === 'weekly' ? 7 : 30;
    if (s.lastRunAt && now.getTime() - s.lastRunAt.getTime() < gap * 86400000) continue;
    const from = new Date(now.getTime() - gap * 86400000).toISOString();
    const attachments = [];
    for (const k of s.reportKeys) attachments.push({ filename: `${k}.csv`, content: Buffer.from(await reportCsv(k, { dashboard: s.dashboard, from })) });
    for (const to of s.recipients) await email.send(to, `${s.frequency} report · ${s.dashboard}`, `<p>Attached: ${s.reportKeys.join(', ')}</p>`, attachments).catch(() => null);
    await prisma.reportSchedule.update({ where: { id: s.id }, data: { lastRunAt: now } });
  }
}
