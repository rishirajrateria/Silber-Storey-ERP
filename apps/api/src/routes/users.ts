import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { CreateUserSchema, ROLES, DASHBOARDS } from '@app/shared';
import { requireAdminFull, requireRole } from '../plugins/auth.js';
import { requestUser } from '../services/admin.js';
import { sessions } from '../plugins/session.js';

export async function userRoutes(app: FastifyInstance) {
  app.get('/users', { preHandler: requireRole('admin') }, async () => ({ data: await prisma.user.findMany({ include: { permissions: true }, orderBy: { createdAt: 'asc' } }) }));
  app.post('/users', { preHandler: requireRole('admin') }, async (req) => {
    const b = CreateUserSchema.parse(req.body);
    const u = await prisma.user.create({ data: { email: b.email.toLowerCase(), name: b.name, role: b.role } });
    req.audit = { entityType: 'User', entityId: u.id, after: u };
    return { data: u };
  });
  app.patch('/users/:id', { preHandler: requireRole('admin') }, async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ active: z.boolean().optional(), role: z.enum(ROLES).optional(), name: z.string().optional() }).parse(req.body);
    const before = await prisma.user.findUnique({ where: { id } });
    const u = await prisma.user.update({ where: { id }, data: b });
    if (b.active === false || (b.role && before && b.role !== before.role)) await sessions.destroyAllForUser(id); // removing/changing access revokes sessions immediately
    req.audit = { entityType: 'User', entityId: id, before, after: u };
    return { data: u };
  });
  app.post('/users/request', { preHandler: requireRole('all') }, async (req) => ({ data: await requestUser(req.user!, CreateUserSchema.parse(req.body)) }));
  app.get('/admin/permissions/:adminUserId', { preHandler: requireAdminFull('global') }, async (req) => { const { adminUserId } = req.params as { adminUserId: string }; return { data: await prisma.adminPermission.findMany({ where: { adminUserId } }) }; });
  app.put('/admin/permissions/:adminUserId', { preHandler: requireAdminFull('global') }, async (req) => {
    const { adminUserId } = req.params as { adminUserId: string };
    const b = z.array(z.object({ dashboard: z.enum(DASHBOARDS), level: z.enum(['none', 'read', 'full']), canApprove: z.boolean().default(false) })).parse(req.body);
    const before = await prisma.adminPermission.findMany({ where: { adminUserId } });
    await prisma.$transaction(async (tx) => { await tx.adminPermission.deleteMany({ where: { adminUserId } }); for (const p of b) await tx.adminPermission.create({ data: { adminUserId, ...p } }); });
    const after = await prisma.adminPermission.findMany({ where: { adminUserId } });
    req.audit = { entityType: 'AdminPermission', entityId: adminUserId, before, after };
    return { data: after };
  });
}
