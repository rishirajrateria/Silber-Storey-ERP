import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireCanApprove, requireRole } from '../plugins/auth.js';
import { decide } from '../services/approvals.js';

export async function approvalRoutes(app: FastifyInstance) {
  app.get('/approvals', { preHandler: requireRole('all') }, async (req) => {
    const q = z.object({ mine: z.string().optional(), dashboard: z.string().optional(), status: z.string().optional() }).parse(req.query);
    const where: any = {};
    if (q.mine || req.user!.role !== 'admin') where.requestedByUserId = req.user!.id;
    if (q.status) where.status = q.status;
    if (q.dashboard && req.user!.role === 'admin') where.type = { in: ({ sales: ['duplicate_override', 'new_user'], engineer: ['quote_version', 'meeting_invite'], finance: ['milestone_pct_change', 'credit_note'] } as Record<string, string[]>)[q.dashboard] ?? [] };
    return { data: await prisma.approval.findMany({ where, include: { lead: { include: { client: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }) };
  });
  app.post('/approvals/:id/decide', { preHandler: requireCanApprove }, async (req) => { const { id } = req.params as { id: string }; const b = z.object({ approve: z.boolean(), remark: z.string().optional() }).parse(req.body); const r = await decide(req.user!, id, b.approve, b.remark); req.audit = { entityType: 'Approval', entityId: id, after: r }; return { data: r }; });
  app.get('/delays', { preHandler: requireRole('all') }, async (req) => {
    const q = z.object({ mine: z.string().optional(), dashboard: z.string().optional(), resolved: z.string().optional() }).parse(req.query);
    const where: any = {};
    if (q.mine || req.user!.role !== 'admin') where.userId = req.user!.id;
    if (q.dashboard) where.dashboard = q.dashboard;
    if (q.resolved !== '1') where.resolvedAt = null;
    return { data: await prisma.delay.findMany({ where, include: { lead: { include: { client: true } } }, orderBy: { breachedAt: 'desc' }, take: 200 }) };
  });
}
