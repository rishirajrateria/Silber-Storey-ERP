import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireRole } from '../plugins/auth.js';
import * as h from '../services/handover.js';
import { LEAD_INCLUDE, serializeLead } from '../services/leads.js';

export async function designRoutes(app: FastifyInstance) {
  app.get('/design/leads', { preHandler: requireRole('design_head', 'junior_designer') }, async (req) => {
    const where = req.user!.role === 'junior_designer' ? { handover: { juniorUserId: req.user!.id } } : req.user!.role === 'design_head' ? { handover: { designHeadUserId: req.user!.id } } : { handover: { isNot: null } };
    const items = await prisma.lead.findMany({ where: { ...where, archived: false }, include: { ...LEAD_INCLUDE, meetings: { where: { kind: { in: ['internal', 'second_client'] } } } }, orderBy: { pushedToDesignAt: 'desc' } });
    return { data: items.map((l) => serializeLead(req.user!, l)) };
  });
  app.get('/design/leads/:id/package', { preHandler: requireRole('design_head', 'junior_designer', 'engineer') }, async (req) => {
    // Handover package: final quote text, MoMs, notes, files, client profile (junior: redacted contact)
    const { id } = req.params as { id: string };
    const lead = await prisma.lead.findFirst({ where: { id, ...(req.user!.role === 'junior_designer' ? { handover: { juniorUserId: req.user!.id } } : req.user!.role === 'design_head' ? { handover: { designHeadUserId: req.user!.id } } : req.user!.role === 'engineer' ? { engineerUserId: req.user!.id } : {}) }, include: { ...LEAD_INCLUDE, quote: { include: { versions: { where: { isFinal: true } } } }, meetings: { include: { mom: { select: { text: true, createdAt: true } } }, orderBy: { startAt: 'asc' } }, notes: { orderBy: { at: 'desc' } }, files: true } });
    if (!lead) return { data: null };
    return { data: serializeLead(req.user!, lead) };
  });
  app.post('/leads/:id/push-to-design', { preHandler: requireRole('engineer') }, async (req) => { const { id } = req.params as { id: string }; const { designHeadUserId } = z.object({ designHeadUserId: z.string() }).parse(req.body); return { data: await h.pushToDesign(req.user!, id, designHeadUserId) }; });
  app.post('/handovers/:leadId/assign-junior', { preHandler: requireRole('design_head') }, async (req) => { const { leadId } = req.params as { leadId: string }; const { juniorUserId } = z.object({ juniorUserId: z.string() }).parse(req.body); return { data: await h.assignJunior(req.user!, leadId, juniorUserId) }; });
  app.post('/handovers/:leadId/accept', { preHandler: requireRole('engineer', 'design_head', 'junior_designer') }, async (req) => { const { leadId } = req.params as { leadId: string }; return { data: await h.accept(req.user!, leadId) }; });
  app.get('/handovers/:leadId', { preHandler: requireRole('engineer', 'design_head', 'junior_designer', 'admin') }, async (req) => { const { leadId } = req.params as { leadId: string }; return { data: await prisma.handover.findUnique({ where: { leadId } }) }; });
}
