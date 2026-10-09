import type { LeadStage } from '@prisma/client';
import { prisma, type Tx } from '../lib/db.js';
import { rt } from '../realtime.js';
import { STAGES } from '@app/shared';

/** Section 4: every stage transition → StatusHistory(dashboard='stage'). Never moves backwards. */
export async function setStage(leadId: string, stage: LeadStage, byUserId: string, tx: Tx | typeof prisma = prisma) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
  if (STAGES.indexOf(stage) <= STAGES.indexOf(lead.stage)) return lead;
  const updated = await tx.lead.update({ where: { id: leadId }, data: { stage } });
  await tx.statusHistory.create({ data: { leadId, dashboard: 'stage', fromStatusId: lead.stage, toStatusId: stage, byUserId } });
  rt.lead(leadId, { type: 'stage', stage });
  return updated;
}

export async function setEngineerStatusByKey(leadId: string, key: string, byUserId: string, reason?: string, tx: Tx | typeof prisma = prisma) {
  const st = await tx.leadStatus.findUniqueOrThrow({ where: { dashboard_key: { dashboard: 'engineer', key } } });
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
  if (lead.engineerStatusId === st.id) return lead;
  const updated = await tx.lead.update({ where: { id: leadId }, data: { engineerStatusId: st.id } });
  await tx.statusHistory.create({ data: { leadId, dashboard: 'engineer', fromStatusId: lead.engineerStatusId, toStatusId: st.id, byUserId, reason } });
  rt.lead(leadId, { type: 'status', dashboard: 'engineer', key });
  return updated;
}
