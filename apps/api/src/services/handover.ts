import { prisma } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import type { AuthUser } from '../plugins/auth.js';
import { notify } from './notifications.js';
import { setEngineerStatusByKey, setStage } from './stage.js';
import { rt } from '../realtime.js';

/* Rule 9.12: push to design only after advance_paid */
export async function pushToDesign(u: AuthUser, leadId: string, designHeadUserId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { client: true, handover: true } });
  if (!lead) throw notFound('Lead');
  if (u.role === 'engineer' && lead.engineerUserId !== u.id) throw forbidden('Not your lead');
  if (lead.handover) throw conflict('ALREADY_PUSHED', 'Already pushed to design');
  const paid = await prisma.milestone.findFirst({ where: { pipeline: { leadId }, order: 1, status: 'paid' } });
  if (!paid) throw conflict('ADVANCE_NOT_PAID', 'Push to design requires the advance (milestone 1) to be paid');
  const head = await prisma.user.findFirst({ where: { id: designHeadUserId, role: 'design_head', active: true } });
  if (!head) throw badRequest('Design head not found');
  const h = await prisma.$transaction(async (tx) => {
    const h = await tx.handover.create({ data: { leadId, designHeadUserId } });
    await tx.lead.update({ where: { id: leadId }, data: { pushedToDesignAt: new Date(), designHeadUserId } });
    await setStage(leadId, 'pushed_to_design', u.id, tx);
    return h;
  });
  await setEngineerStatusByKey(leadId, 'pushed_to_design', u.id);
  await notify(head.id, 'pushed_to_design', 'New handover', `${lead.client.name ?? lead.client.phone} pushed to design`, `/design/leads/${leadId}`);
  return h;
}

/* Rule 9.14: reassigning junior moves everything (access derived from Handover.juniorUserId) */
export async function assignJunior(u: AuthUser, leadId: string, juniorUserId: string) {
  const h = await prisma.handover.findUnique({ where: { leadId }, include: { lead: { include: { client: true } } } });
  if (!h) throw notFound('Handover');
  if (u.role === 'design_head' && h.designHeadUserId !== u.id) throw forbidden('Not your handover');
  const junior = await prisma.user.findFirst({ where: { id: juniorUserId, role: 'junior_designer', active: true } });
  if (!junior) throw badRequest('Junior designer not found');
  const upd = await prisma.$transaction(async (tx) => {
    const x = await tx.handover.update({ where: { leadId }, data: { juniorUserId, acceptedByJuniorAt: h.juniorUserId === juniorUserId ? h.acceptedByJuniorAt : null } });
    await tx.lead.update({ where: { id: leadId }, data: { juniorUserId } });
    return x;
  });
  await notify(junior.id, 'junior_assigned', 'Project assigned to you', h.lead.client.name ?? '', `/design/leads/${leadId}`);
  rt.lead(leadId, { type: 'handover' });
  return upd;
}

/* Rule 9.12: triple acceptance */
export async function accept(u: AuthUser, leadId: string) {
  const h = await prisma.handover.findUnique({ where: { leadId }, include: { lead: { include: { client: true } } } });
  if (!h) throw notFound('Handover');
  const data: any = {};
  if (u.role === 'engineer') { if (h.lead.engineerUserId !== u.id) throw forbidden('Not your lead'); data.acceptedByEngineerAt = h.acceptedByEngineerAt ?? new Date(); }
  else if (u.role === 'design_head') { if (h.designHeadUserId !== u.id) throw forbidden('Not your handover'); data.acceptedByHeadAt = h.acceptedByHeadAt ?? new Date(); }
  else if (u.role === 'junior_designer') { if (h.juniorUserId !== u.id) throw forbidden('Not assigned to you'); data.acceptedByJuniorAt = h.acceptedByJuniorAt ?? new Date(); }
  else throw forbidden('Only engineer, design head and junior accept handovers');
  let upd = await prisma.handover.update({ where: { leadId }, data });
  const all = upd.acceptedByEngineerAt && upd.acceptedByHeadAt && upd.acceptedByJuniorAt;
  if (all && !upd.completedAt) {
    upd = await prisma.$transaction(async (tx) => {
      const x = await tx.handover.update({ where: { leadId }, data: { completedAt: new Date() } });
      await tx.lead.update({ where: { id: leadId }, data: { handoverCompletedAt: new Date() } });
      await setStage(leadId, 'handover_accepted', u.id, tx);
      return x;
    });
    await setEngineerStatusByKey(leadId, 'handover_complete', u.id);
    for (const id of [h.lead.engineerUserId, h.designHeadUserId, h.juniorUserId]) if (id) await notify(id, 'handover_complete', 'Handover complete', h.lead.client.name ?? '', `/design/leads/${leadId}`);
  } else {
    for (const id of [h.lead.engineerUserId, h.designHeadUserId, h.juniorUserId]) if (id && id !== u.id) await notify(id, 'handover_accepted', `${u.name} accepted the handover`, h.lead.client.name ?? '', `/design/leads/${leadId}`);
  }
  rt.lead(leadId, { type: 'handover' });
  return upd;
}

/* Rule 9.13: engineer may see a design user's calendar only while a lead is in transfer */
export async function canViewCalendar(u: AuthUser, targetUserId: string) {
  if (u.role === 'admin' || u.id === targetUserId) return true;
  if (u.role !== 'engineer') return false;
  const n = await prisma.lead.count({ where: { engineerUserId: u.id, pushedToDesignAt: { not: null }, handoverCompletedAt: null, OR: [{ handover: { designHeadUserId: targetUserId } }, { handover: { juniorUserId: targetUserId } }] } });
  return n > 0;
}
