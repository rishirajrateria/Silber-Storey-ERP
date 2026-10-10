import type { ApprovalType } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import type { AuthUser } from '../plugins/auth.js';
import { notify, notifyAdmins } from './notifications.js';
import { rt } from '../realtime.js';

export async function createApproval(input: { type: ApprovalType; entityType: string; entityId: string; leadId?: string | null; requestedByUserId: string; payload: Record<string, unknown> }) {
  const existing = await prisma.approval.findFirst({ where: { type: input.type, entityId: input.entityId, status: 'pending' } });
  if (existing) throw conflict('APPROVAL_PENDING', 'An approval is already pending for this item');
  const a = await prisma.approval.create({ data: { ...input, payload: input.payload as any } });
  rt.approvals({ type: 'created', approval: a });
  const titles: Record<string, string> = { duplicate_override: 'Duplicate override requested', quote_version: 'Quote approval requested', milestone_pct_change: 'Milestone % change requested', credit_note: 'Credit note requested', invoice_cancellation: 'Invoice cancellation requested', new_user: 'New user requested', meeting_invite: 'Meeting invite' };
  const ev = ({ duplicate_override: 'duplicate_override_requested', quote_version: 'quote_approval_requested', milestone_pct_change: 'pct_change_requested', credit_note: 'credit_note_requested', invoice_cancellation: 'credit_note_requested', new_user: 'new_user_requested', meeting_invite: 'admin_invite' } as const)[input.type];
  await notifyAdmins(ev, titles[input.type], `Requested by user ${input.requestedByUserId}`, `/admin/approvals`);
  return a;
}

/** POST /approvals/:id/decide — dispatches per type. Each handler lives in its own domain service. */
export async function decide(u: AuthUser, id: string, approve: boolean, remark?: string) {
  const a = await prisma.approval.findUnique({ where: { id } });
  if (!a) throw notFound('Approval');
  if (a.status !== 'pending') throw conflict('ALREADY_DECIDED', 'Already decided');
  if (!approve && !remark?.trim() && a.type !== 'meeting_invite') throw badRequest('Rejection requires a remark');
  const updated = await prisma.approval.update({ where: { id }, data: { status: approve ? 'approved' : 'rejected', decidedByUserId: u.id, decidedAt: new Date(), remark } });
  const handler = handlers[a.type];
  if (handler) await handler(updated as any, approve, u, remark);
  rt.approvals({ type: 'decided', approval: updated });
  return updated;
}

type Handler = (a: { id: string; entityId: string; leadId: string | null; requestedByUserId: string; payload: any }, approve: boolean, u: AuthUser, remark?: string) => Promise<void>;
const handlers: Partial<Record<ApprovalType, Handler>> = {};
export function registerApprovalHandler(type: ApprovalType, h: Handler) { handlers[type] = h; }

/* duplicate_override: approved ⇒ create the lead (rule 9.1) */
registerApprovalHandler('duplicate_override', async (a, approve, u, remark) => {
  if (approve) {
    const { createLead } = await import('./leads.js');
    const requester = await prisma.user.findUniqueOrThrow({ where: { id: a.requestedByUserId } });
    const lead = await createLead({ id: requester.id, role: requester.role, email: requester.email, name: requester.name, permissions: [] }, a.payload, { overrideApprovalId: a.id });
    await prisma.approval.update({ where: { id: a.id }, data: { leadId: lead.id, entityId: lead.id } });
    await notify(a.requestedByUserId, 'duplicate_override_decided', 'Duplicate override approved', `Lead created for ${a.payload.phone}`, `/sales/leads/${lead.id}`);
  } else await notify(a.requestedByUserId, 'duplicate_override_decided', 'Duplicate override rejected', remark ?? '', '/sales/leads');
});

/* new_user: approved ⇒ create User */
registerApprovalHandler('new_user', async (a, approve, _u, remark) => {
  if (approve) {
    const p = a.payload as { email: string; name: string; role: any };
    await prisma.user.upsert({ where: { email: p.email }, create: { email: p.email, name: p.name, role: p.role }, update: { active: true, role: p.role } });
  }
  await notify(a.requestedByUserId, 'new_user_requested', approve ? 'New user approved' : 'New user rejected', remark ?? '', undefined);
});
