import { prisma } from './db.js';

export interface AuditInput {
  actorUserId?: string | null; actorRole?: string | null; action: string; entityType?: string; entityId?: string;
  before?: unknown; after?: unknown; ip?: string; userAgent?: string;
}
export async function writeAudit(a: AuditInput) {
  await prisma.auditLog.create({
    data: {
      actorUserId: a.actorUserId ?? null, actorRole: a.actorRole ?? null, action: a.action, entityType: a.entityType, entityId: a.entityId,
      before: a.before === undefined ? undefined : (a.before as any), after: a.after === undefined ? undefined : (a.after as any),
      ip: a.ip, userAgent: a.userAgent?.slice(0, 300),
    },
  });
}
