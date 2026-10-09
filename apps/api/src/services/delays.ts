import { prisma } from '../lib/db.js';
import { notify, notifyAdmins } from './notifications.js';

type Breach = { leadId: string; userId: string };
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000);

/** Rule 9.19 / Section 10: evaluates each DelayRule, creates Delay once per breach, auto-resolves. */
export async function evaluateDelays() {
  const rules = await prisma.delayRule.findMany({ where: { active: true } });
  for (const rule of rules) {
    const breaches = await findBreaches(rule.dashboard, rule.ruleKey, rule.thresholdHours);
    const open = await prisma.delay.findMany({ where: { dashboard: rule.dashboard, ruleKey: rule.ruleKey, resolvedAt: null } });
    for (const b of breaches) {
      if (open.some((o) => o.leadId === b.leadId)) continue;
      await prisma.delay.create({ data: { leadId: b.leadId, dashboard: rule.dashboard, ruleKey: rule.ruleKey, thresholdHours: rule.thresholdHours, userId: b.userId } });
      const lead = await prisma.lead.findUnique({ where: { id: b.leadId }, include: { client: true } });
      const body = `${rule.ruleKey.replace(/_/g, ' ')} · ${lead?.client.name ?? lead?.client.phone ?? ''} · > ${rule.thresholdHours}h`;
      await notify(b.userId, 'delay_breached', 'SLA breached', body);
      await notifyAdmins('delay_breached', 'SLA breached', body, '/admin/delays');
    }
    for (const o of open) if (!breaches.some((b) => b.leadId === o.leadId)) await prisma.delay.update({ where: { id: o.id }, data: { resolvedAt: new Date() } });
  }
}

async function findBreaches(dashboard: string, ruleKey: string, h: number): Promise<Breach[]> {
  const t = hoursAgo(h);
  switch (`${dashboard}:${ruleKey}`) {
    case 'sales:lead_not_contacted':
      return (await prisma.lead.findMany({ where: { archived: false, salesStatus: { key: 'no_status' }, leadDate: { lt: t } } })).map((l) => ({ leadId: l.id, userId: l.salesUserId }));
    case 'sales:followup_overdue':
      return (await prisma.followUp.findMany({ where: { done: false, dueAt: { lt: t }, lead: { transferredToEngineerAt: null, archived: false } } })).map((f) => ({ leadId: f.leadId, userId: f.userId }));
    case 'engineer:no_first_contact_after_transfer':
      return (await prisma.lead.findMany({ where: { archived: false, transferredToEngineerAt: { lt: t }, engineerStatusId: null } })).map((l) => ({ leadId: l.id, userId: l.engineerUserId! }));
    case 'engineer:followup_overdue':
      return (await prisma.followUp.findMany({ where: { done: false, dueAt: { lt: t }, lead: { transferredToEngineerAt: { not: null }, archived: false } } })).map((f) => ({ leadId: f.leadId, userId: f.userId }));
    case 'engineer:meeting_done_no_quote': {
      const leads = await prisma.lead.findMany({ where: { archived: false, stage: 'meeting_done', quote: null }, include: { meetings: { where: { status: 'completed' }, orderBy: { endAt: 'desc' }, take: 1 } } });
      return leads.filter((l) => l.meetings[0] && l.meetings[0].endAt < t).map((l) => ({ leadId: l.id, userId: l.engineerUserId! }));
    }
    case 'engineer:billing_missing_after_acceptance': {
      const vs = await prisma.quoteVersion.findMany({ where: { clientAcceptedAt: { lt: t }, isFinal: true, quote: { lead: { billing: null, archived: false, pushedToFinanceAt: null } } }, include: { quote: { include: { lead: true } } } });
      return vs.map((v) => ({ leadId: v.quote.leadId, userId: v.quote.lead.engineerUserId! }));
    }
    case 'admin:quote_approval_pending':
    case 'admin:approval_pending_any': {
      const as = await prisma.approval.findMany({ where: { status: 'pending', createdAt: { lt: t }, leadId: { not: null }, ...(ruleKey === 'quote_approval_pending' ? { type: 'quote_version' } : {}) } });
      const admin = await prisma.user.findFirst({ where: { role: 'admin', active: true } });
      return admin ? as.map((a) => ({ leadId: a.leadId!, userId: admin.id })) : [];
    }
    case 'finance:invoice_not_sent_after_push':
      return (await prisma.lead.findMany({ where: { archived: false, pushedToFinanceAt: { lt: t }, invoices: { none: { status: { not: 'draft' } } } } })).map((l) => ({ leadId: l.id, userId: l.financeUserId ?? l.engineerUserId! }));
    case 'finance:invoice_unpaid':
      return (await prisma.invoice.findMany({ where: { status: { in: ['sent', 'partially_paid'] }, sentAt: { lt: t } }, include: { lead: true } })).map((i) => ({ leadId: i.leadId, userId: i.lead.financeUserId ?? i.lead.engineerUserId! }));
    case 'design_head:junior_not_assigned':
      return (await prisma.handover.findMany({ where: { juniorUserId: null, createdAt: { lt: t } } })).map((h) => ({ leadId: h.leadId, userId: h.designHeadUserId }));
    case 'all:handover_acceptance_pending': {
      const hs = await prisma.handover.findMany({ where: { completedAt: null, createdAt: { lt: t } }, include: { lead: true } });
      const out: Breach[] = [];
      for (const h of hs) { if (!h.acceptedByEngineerAt && h.lead.engineerUserId) out.push({ leadId: h.leadId, userId: h.lead.engineerUserId }); if (!h.acceptedByHeadAt) out.push({ leadId: h.leadId, userId: h.designHeadUserId }); if (h.juniorUserId && !h.acceptedByJuniorAt) out.push({ leadId: h.leadId, userId: h.juniorUserId }); }
      return out;
    }
    default: return [];
  }
}
