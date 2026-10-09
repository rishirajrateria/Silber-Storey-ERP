import type { FastifyInstance } from 'fastify';
import { writeAudit } from '../lib/audit.js';

/** Rule 9.18: every non-GET request is audited with optional before/after snapshot set by the handler. */
export function registerAuditHook(app: FastifyInstance) {
  app.addHook('onResponse', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    if (req.url.startsWith('/api/v1/me/location') || req.url.startsWith('/api/v1/auth/')) return;
    const a = req.audit ?? {};
    const params = (req.params ?? {}) as Record<string, string>;
    try {
      await writeAudit({
        actorUserId: req.user?.id, actorRole: req.user?.role, action: a.action ?? `${req.method} ${req.routeOptions?.url ?? req.url}`,
        entityType: a.entityType ?? req.routeOptions?.url?.split('/')[3], entityId: a.entityId ?? params.id ?? params.leadId ?? params.vid ?? params.token?.slice(0, 0),
        before: a.before, after: a.after ?? (reply.statusCode < 400 ? scrub(req.body) : undefined), ip: req.ip, userAgent: req.headers['user-agent'],
      });
    } catch (e) { req.log.error({ err: e }, 'audit failed'); }
  });
}
const scrub = (b: unknown) => {
  if (!b || typeof b !== 'object' || Buffer.isBuffer(b)) return undefined;
  const s = JSON.stringify(b, (k, v) => (/token|secret|password/i.test(k) ? '[redacted]' : v));
  return s.length > 20000 ? { truncated: true } : JSON.parse(s);
};
