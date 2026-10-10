import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import type { AuthUser } from '../plugins/auth.js';
import { adminLevel } from '../plugins/auth.js';
import { calendar, maps } from '../integrations/index.js';
import { notify } from './notifications.js';
import { setStage } from './stage.js';
import { rt } from '../realtime.js';
import { enqueue } from '../jobs/queue.js';

export const LEAD_INCLUDE = {
  client: true, salesStatus: true, engineerStatus: true, billing: true, handover: true,
} satisfies Prisma.LeadInclude;

/* ---------- scoping (5.2) ---------- */
export function scopeWhere(u: AuthUser, dashboard?: string): Prisma.LeadWhereInput {
  switch (u.role) {
    case 'admin': {
      if (!dashboard || dashboard === 'global') return {};
      if (adminLevel(u, dashboard) === 'none') throw forbidden('No permission for this dashboard');
      return dashboardWhere(dashboard);
    }
    case 'sales': return { salesUserId: u.id };
    case 'engineer': return { engineerUserId: u.id, transferredToEngineerAt: { not: null } };
    case 'finance': return { pushedToFinanceAt: { not: null } };
    case 'design_head': return { handover: { designHeadUserId: u.id } };
    case 'junior_designer': return { handover: { juniorUserId: u.id } };
  }
}
const dashboardWhere = (d: string): Prisma.LeadWhereInput =>
  d === 'sales' ? {} : d === 'engineer' ? { transferredToEngineerAt: { not: null } } : d === 'finance' ? { pushedToFinanceAt: { not: null } } : { handover: { isNot: null } };

export async function getScopedLead(u: AuthUser, id: string) {
  const lead = await prisma.lead.findFirst({ where: { id, ...scopeWhere(u) }, include: LEAD_INCLUDE });
  if (!lead) throw notFound('Lead');
  return lead;
}

/* ---------- serialization & redaction (9.9, 9.12, 9.22) ---------- */
export function serializeLead(u: AuthUser, lead: any) {
  if (u.role === 'engineer' && lead.handoverCompletedAt) return { id: lead.id, clientName: lead.client?.name ?? null, stage: lead.stage, headerOnly: true };
  const out = JSON.parse(JSON.stringify(lead));
  if (u.role === 'junior_designer') {
    if (out.client) { delete out.client.phone; delete out.client.email; }
    if (out.billing) { delete out.billing.contactName; delete out.billing.contactPhone; delete out.billing.contactEmail; }
  }
  if (u.role === 'finance') { delete out.meetings; delete out.notes; delete out.recordings; delete out.aiProfile; }
  return out;
}

/* ---------- create + duplicate rule (9.1) ---------- */
export async function createLead(u: AuthUser, input: { phone: string; name?: string; locationArea?: string; ethnicity?: string; gender?: string; email?: string; requirement?: string; sourceId: string }, opts: { overrideApprovalId?: string } = {}) {
  const existing = await prisma.client.findUnique({ where: { phone: input.phone }, include: { leads: { orderBy: { leadDate: 'desc' }, take: 1, include: { salesStatus: true, engineerStatus: true } } } });
  if (existing && !opts.overrideApprovalId) {
    const last = existing.leads[0];
    const leadCount = await prisma.lead.count({ where: { clientId: existing.id } });
    throw conflict('DUPLICATE', 'A client with this phone already exists', { existingClient: { id: existing.id, name: existing.name, lastStatus: last?.engineerStatus?.label ?? last?.salesStatus?.label ?? null, lastLeadDate: last?.leadDate ?? null, leadCount } });
  }
  const source = await prisma.leadSource.findUnique({ where: { id: input.sourceId } });
  if (!source) throw badRequest('Unknown lead source');
  const noStatus = await prisma.leadStatus.findUniqueOrThrow({ where: { dashboard_key: { dashboard: 'sales', key: 'no_status' } } });
  const lead = await prisma.$transaction(async (tx) => {
    const client = existing
      ? await tx.client.update({ where: { id: existing.id }, data: { name: input.name ?? existing.name, email: input.email ?? existing.email, locationArea: input.locationArea ?? existing.locationArea, deletedAt: null } })
      : await tx.client.create({ data: { phone: input.phone, name: input.name, email: input.email, ethnicity: input.ethnicity, gender: input.gender, locationArea: input.locationArea } });
    const prev = existing ? existing.leads[0] : null;
    const l = await tx.lead.create({
      data: { clientId: client.id, previousLeadId: prev?.id, source: source.label, requirement: input.requirement, salesStatusId: noStatus.id, salesUserId: u.id, stage: 'lead_received' },
      include: LEAD_INCLUDE,
    });
    await tx.statusHistory.create({ data: { leadId: l.id, dashboard: 'stage', toStatusId: 'lead_received', byUserId: u.id } });
    await tx.statusHistory.create({ data: { leadId: l.id, dashboard: 'sales', toStatusId: noStatus.id, byUserId: u.id } });
    return l;
  });
  return lead;
}

/* ---------- status change (9.3) ---------- */
export async function changeStatus(u: AuthUser, leadId: string, input: { statusId: string; reason?: string; followUpAt?: string; priority?: 'low' | 'med' | 'high' }) {
  const lead = await getScopedLead(u, leadId);
  const status = await prisma.leadStatus.findUnique({ where: { id: input.statusId } });
  if (!status || !status.active) throw badRequest('Unknown status');
  const dashboard = status.dashboard;
  if (u.role === 'sales' && dashboard !== 'sales') throw forbidden('Sales cannot set engineer statuses');
  if (u.role === 'engineer' && dashboard !== 'engineer') throw forbidden('Engineer cannot change the Sales status');
  if (u.role === 'admin' && adminLevel(u, dashboard) !== 'full') throw forbidden('Admin needs full permission on this dashboard');
  if (dashboard === 'sales' && lead.transferredToEngineerAt) throw forbidden('Lead transferred: Sales is read-only');
  if (status.isSystem && status.key !== 'quote_approved_payment') throw conflict('SYSTEM_STATUS', 'System statuses cannot be set manually');
  if (status.key === 'lost' && !input.reason?.trim()) throw badRequest('Lost requires a reason');
  if (status.requiresFollowUp && (!input.followUpAt || !input.priority)) throw badRequest('This status requires a follow-up date and priority');
  if (dashboard === 'engineer' && !lead.transferredToEngineerAt) throw conflict('NOT_TRANSFERRED', 'Lead not yet transferred to engineer');

  const fromId = dashboard === 'sales' ? lead.salesStatusId : lead.engineerStatusId;
  if (fromId === status.id && !status.requiresFollowUp) return lead;
  const updated = await prisma.$transaction(async (tx) => {
    const data: Prisma.LeadUpdateInput = dashboard === 'sales' ? { salesStatus: { connect: { id: status.id } } } : { engineerStatus: { connect: { id: status.id } } };
    if (status.key === 'lost') { data.lostReason = input.reason; data.lostByRole = u.role as any; }
    if (status.key === 'seems_positive') { /* stage qualified_by_sales set below */ }
    const l = await tx.lead.update({ where: { id: leadId }, data, include: LEAD_INCLUDE });
    await tx.statusHistory.create({ data: { leadId, dashboard, fromStatusId: fromId, toStatusId: status.id, reason: input.reason, followUpAt: input.followUpAt ? new Date(input.followUpAt) : null, priority: input.priority, byUserId: u.id } });
    if (status.requiresFollowUp) {
      const dueAt = new Date(input.followUpAt!);
      const ev = await calendar.createEvent(u.id, { title: `Follow-up: ${l.client.name ?? l.client.phone}`, start: dueAt, end: new Date(dueAt.getTime() + 30 * 60000), description: `Lead ${leadId}` }).catch(() => null);
      await tx.followUp.create({ data: { leadId, userId: u.id, dueAt, priority: input.priority!, calendarEventId: ev?.eventId } });
    }
    return l;
  });
  if (status.key === 'seems_positive') await setStage(leadId, 'qualified_by_sales', u.id);
  if (dashboard === 'engineer' && ['contacted_no_response', 'call_later', 'in_pipeline', 'asked_quote'].includes(status.key)) await setStage(leadId, 'first_contact', u.id);
  if (status.key === 'quote_approved_payment') await setStage(leadId, 'client_accepted_final', u.id);
  if (status.requiresFollowUp) await notify(u.id, 'followup_due', 'Follow-up scheduled', `${updated.client.name ?? updated.client.phone} on ${new Date(input.followUpAt!).toLocaleString()}`, leadLink(u.role, leadId));
  rt.lead(leadId, { type: 'status', dashboard });
  return updated;
}

/* ---------- transfer (9.2) ---------- */
export async function transferToEngineer(u: AuthUser, leadId: string, engineerUserId?: string) {
  const lead = await getScopedLead(u, leadId);
  if (lead.transferredToEngineerAt) throw conflict('ALREADY_TRANSFERRED', 'Already transferred');
  if (lead.salesStatus.key !== 'seems_positive' || !lead.genuine) throw conflict('TRANSFER_BLOCKED', 'Transfer requires Seems positive + Genuine');
  const engineer = engineerUserId ? await prisma.user.findFirst({ where: { id: engineerUserId, role: 'engineer', active: true } }) : await prisma.user.findFirst({ where: { role: 'engineer', active: true }, orderBy: { createdAt: 'asc' } });
  if (!engineer) throw conflict('NO_ENGINEER', 'No active engineer to assign');
  const transferred = await prisma.leadStatus.findUniqueOrThrow({ where: { dashboard_key: { dashboard: 'sales', key: 'transferred' } } });
  const updated = await prisma.$transaction(async (tx) => {
    const l = await tx.lead.update({ where: { id: leadId }, data: { salesStatusId: transferred.id, engineerUserId: engineer.id, transferredToEngineerAt: new Date() }, include: LEAD_INCLUDE });
    await tx.statusHistory.create({ data: { leadId, dashboard: 'sales', fromStatusId: lead.salesStatusId, toStatusId: transferred.id, byUserId: u.id } });
    await setStage(leadId, 'transferred_to_engineer', u.id, tx);
    return l;
  });
  await notify(engineer.id, 'lead_assigned', 'New lead assigned', `${lead.client.name ?? lead.client.phone} transferred by ${u.name}`, `/engineer/leads/${leadId}`);
  void updated;
  return prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: LEAD_INCLUDE });
}

export async function setGenuine(u: AuthUser, leadId: string, genuine: boolean) {
  const lead = await getScopedLead(u, leadId);
  if (lead.transferredToEngineerAt) throw forbidden('Lead transferred: Sales is read-only');
  return prisma.lead.update({ where: { id: leadId }, data: { genuine }, include: LEAD_INCLUDE });
}

export async function patchLead(u: AuthUser, leadId: string, input: { budget?: number | null; name?: string; exactAddress?: string; gender?: string; requirement?: string }) {
  const lead = await getScopedLead(u, leadId);
  if (u.role === 'sales' && lead.transferredToEngineerAt) throw forbidden('Lead transferred: Sales is read-only');
  const clientData: Prisma.ClientUpdateInput = {};
  if (input.name !== undefined) clientData.name = input.name;
  if (input.gender !== undefined) clientData.gender = input.gender;
  if (input.exactAddress !== undefined) {
    clientData.exactAddress = input.exactAddress;
    const geo = input.exactAddress ? await maps.geocode(input.exactAddress) : null;
    clientData.addressLat = geo?.lat ?? null; clientData.addressLng = geo?.lng ?? null;
  }
  return prisma.lead.update({
    where: { id: leadId },
    data: { budget: input.budget === undefined ? undefined : input.budget, requirement: input.requirement, client: Object.keys(clientData).length ? { update: clientData } : undefined },
    include: LEAD_INCLUDE,
  });
}

export async function revive(u: AuthUser, leadId: string, statusId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: LEAD_INCLUDE });
  if (!lead) throw notFound('Lead');
  const st = await prisma.leadStatus.findUnique({ where: { id: statusId } });
  if (!st || st.key === 'lost' || st.isSystem) throw badRequest('Choose a non-system, non-lost status');
  if (u.role === 'sales' && (lead.salesUserId !== u.id || st.dashboard !== 'sales')) throw forbidden('Not your lead');
  if (u.role === 'engineer' && (lead.engineerUserId !== u.id || st.dashboard !== 'engineer')) throw forbidden('Not your lead');
  const fromId = st.dashboard === 'sales' ? lead.salesStatusId : lead.engineerStatusId;
  return prisma.$transaction(async (tx) => {
    const l = await tx.lead.update({ where: { id: leadId }, data: { ...(st.dashboard === 'sales' ? { salesStatusId: st.id } : { engineerStatusId: st.id }), lostReason: null, lostByRole: null, archived: false }, include: LEAD_INCLUDE });
    await tx.statusHistory.create({ data: { leadId, dashboard: st.dashboard, fromStatusId: fromId, toStatusId: st.id, reason: 'revived', byUserId: u.id } });
    return l;
  });
}

export async function reassign(u: AuthUser, leadId: string, role: string, userId: string) {
  const target = await prisma.user.findFirst({ where: { id: userId, role: role as any, active: true } });
  if (!target) throw badRequest('User not found for role');
  const field = ({ sales: 'salesUserId', engineer: 'engineerUserId', finance: 'financeUserId', design_head: 'designHeadUserId', junior_designer: 'juniorUserId' } as Record<string, string>)[role];
  if (!field) throw badRequest('Bad role');
  const lead = await prisma.lead.update({ where: { id: leadId }, data: { [field]: userId } as any, include: LEAD_INCLUDE });
  if (role === 'design_head' || role === 'junior_designer') await prisma.handover.updateMany({ where: { leadId }, data: role === 'design_head' ? { designHeadUserId: userId } : { juniorUserId: userId } });
  await notify(userId, 'lead_assigned', 'Lead assigned to you', `${lead.client.name ?? lead.client.phone} reassigned by admin`, leadLink(role, leadId));
  return lead;
}

export const leadLink = (role: string, id: string) => `/${role === 'design_head' || role === 'junior_designer' ? 'design' : role}/leads/${id}`;

/* ---------- timeline (5.2) ---------- */
export async function timeline(u: AuthUser, leadId: string) {
  await getScopedLead(u, leadId);
  const [sh, msgs, meetings, notes, files, approvals, statuses] = await Promise.all([
    prisma.statusHistory.findMany({ where: { leadId } }),
    prisma.message.findMany({ where: { leadId } }),
    u.role === 'finance' ? [] : prisma.meeting.findMany({ where: { leadId } }),
    u.role === 'finance' ? [] : prisma.note.findMany({ where: { leadId } }),
    u.role === 'finance' ? [] : prisma.leadFile.findMany({ where: { leadId } }),
    prisma.approval.findMany({ where: { leadId } }),
    prisma.leadStatus.findMany(),
  ]);
  const label = (id: string) => statuses.find((s) => s.id === id)?.label ?? id;
  const items = [
    ...sh.map((s) => ({ type: 'status', at: s.at, title: s.dashboard === 'stage' ? `Stage → ${s.toStatusId}` : `${s.dashboard} status → ${label(s.toStatusId)}`, detail: s.reason ?? undefined, byUserId: s.byUserId })),
    ...msgs.map((m) => ({ type: 'message', at: m.queuedAt, title: `${m.channel} ${m.direction === 'manual' ? 'logged' : m.status}${m.templateKey ? ` · ${m.templateKey}` : ''}`, detail: m.body.slice(0, 200), byUserId: m.byUserId ?? undefined })),
    ...meetings.map((m) => ({ type: 'meeting', at: m.startAt, title: `${m.kind} meeting (${m.type}) · ${m.status}`, id: m.id })),
    ...notes.map((n) => ({ type: 'note', at: n.at, title: 'Note', detail: n.text, byUserId: n.byUserId })),
    ...files.map((f) => ({ type: 'file', at: f.at, title: `File: ${f.name}`, byUserId: f.byUserId })),
    ...approvals.map((a) => ({ type: 'approval', at: a.createdAt, title: `Approval ${a.type} · ${a.status}`, detail: a.remark ?? undefined })),
  ];
  return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export async function roadmap(leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: LEAD_INCLUDE });
  if (!lead) throw notFound('Lead');
  const hist = await prisma.statusHistory.findMany({ where: { leadId, dashboard: 'stage' }, orderBy: { at: 'asc' } });
  const { getSetting } = await import('../lib/settings.js');
  const th = (await getSetting<Record<string, number>>('stageThresholdDays')) ?? {};
  const steps = hist.map((h, i) => { const days = i < hist.length - 1 ? +((hist[i + 1].at.getTime() - h.at.getTime()) / 86400000).toFixed(2) : +((Date.now() - h.at.getTime()) / 86400000).toFixed(2); return { stage: h.toStatusId, at: h.at, byUserId: h.byUserId, days, thresholdDays: th[h.toStatusId] ?? null, breached: th[h.toStatusId] != null && days > th[h.toStatusId] }; });
  return { lead, steps, thresholds: th };
}

export async function requireNotArchived(lead: { archived: boolean }) { if (lead.archived) throw new AppError(409, 'ARCHIVED', 'Lead archived'); }
export { enqueue };
