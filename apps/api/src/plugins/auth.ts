import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@app/shared';
import { prisma } from '../lib/db.js';
import { AppError, forbidden } from '../lib/errors.js';
import { COOKIE, sessions, type SessionData } from './session.js';

export interface AuthUser { id: string; email: string; name: string; role: Role; permissions: Array<{ dashboard: string; level: string; canApprove: boolean }> }
declare module 'fastify' {
  interface FastifyRequest { user: AuthUser | null; session: SessionData | null; audit?: { entityType?: string; entityId?: string; before?: unknown; after?: unknown; action?: string } }
}

export async function loadUser(req: FastifyRequest) {
  req.user = null; req.session = null;
  const sid = req.cookies?.[COOKIE];
  if (!sid) return;
  const s = await sessions.get(sid);
  if (!s) return;
  const u = await prisma.user.findUnique({ where: { id: s.userId }, include: { permissions: true } });
  if (!u || !u.active) return;
  req.session = s;
  req.user = { id: u.id, email: u.email, name: u.name, role: u.role as Role, permissions: u.permissions.map((p) => ({ dashboard: p.dashboard, level: p.level, canApprove: p.canApprove })) };
  if (Date.now() - new Date(s.lastSeenAt).getTime() > 60_000) {
    await sessions.touch(s);
    prisma.user.update({ where: { id: u.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
}

export const requireAuth = async (req: FastifyRequest) => { if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required'); };

/** RBAC preHandler. `admin` always passes (per-dashboard level is checked in services where needed). */
export const requireRole = (...roles: Array<Role | 'all'>) => async (req: FastifyRequest, _r: FastifyReply) => {
  await requireAuth(req);
  const u = req.user!;
  if (roles.includes('all') || roles.includes(u.role) || u.role === 'admin') return;
  throw forbidden(`Role ${u.role} cannot access this`);
};

export const adminLevel = (u: AuthUser, dashboard: string): 'none' | 'read' | 'full' => {
  if (u.role !== 'admin') return 'none';
  const g = u.permissions.find((p) => p.dashboard === 'global');
  if (g?.level === 'full') return 'full';
  const d = u.permissions.find((p) => p.dashboard === dashboard);
  const lvl = (d?.level ?? g?.level ?? 'none') as any;
  return lvl;
};
export const requireAdminFull = (dashboard: string) => async (req: FastifyRequest) => {
  await requireAuth(req);
  if (req.user!.role !== 'admin' || adminLevel(req.user!, dashboard) !== 'full') throw forbidden('Admin full permission required');
};
export const requireCanApprove = async (req: FastifyRequest) => {
  await requireAuth(req);
  const u = req.user!;
  if (u.role !== 'admin' || !u.permissions.some((p) => p.canApprove)) throw forbidden('Approval permission required');
};
