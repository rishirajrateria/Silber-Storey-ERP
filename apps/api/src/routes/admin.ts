import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireRole, requireAdminFull, adminLevel } from '../plugins/auth.js';
import * as admin from '../services/admin.js';
import { chat } from '../services/aiChat.js';
import { evaluateDelays } from '../services/delays.js';
import { forbidden, notFound } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import { NOTIFICATION_EVENTS, REPORT_KEYS } from '@app/shared';
import { invalidateSettings } from '../lib/settings.js';

export async function adminRoutes(app: FastifyInstance) {
  const adm = requireRole('admin');
  app.get('/admin/settings', { preHandler: adm }, async () => ({ data: await admin.getSettings() }));
  app.put('/admin/settings', { preHandler: requireAdminFull('global') }, async (req) => { const before = await admin.getSettings(); const after = await admin.putSettings(z.record(z.unknown()).parse(req.body)); invalidateSettings(); req.audit = { entityType: 'Setting', entityId: 'all', before, after }; return { data: after }; });

  app.get('/admin/statuses/:dashboard', { preHandler: adm }, async (req) => { const { dashboard } = req.params as { dashboard: 'sales' | 'engineer' }; return { data: await prisma.leadStatus.findMany({ where: { dashboard }, orderBy: { order: 'asc' } }) }; });
  app.post('/admin/statuses/:dashboard', { preHandler: adm }, async (req) => { const { dashboard } = req.params as { dashboard: 'sales' | 'engineer' }; if (adminLevel(req.user!, dashboard) !== 'full') throw forbidden('Full permission required'); return { data: await admin.createStatus(dashboard, z.object({ key: z.string(), label: z.string(), order: z.number().optional(), requiresFollowUp: z.boolean().optional(), isFinal: z.boolean().optional() }).parse(req.body)) }; });
  app.patch('/admin/statuses/:dashboard/:id', { preHandler: adm }, async (req) => { const { id, dashboard } = req.params as { id: string; dashboard: string }; if (adminLevel(req.user!, dashboard) !== 'full') throw forbidden('Full permission required'); return { data: await admin.patchStatus(id, z.object({ label: z.string().optional(), order: z.number().optional(), requiresFollowUp: z.boolean().optional(), isFinal: z.boolean().optional(), active: z.boolean().optional() }).parse(req.body)) }; });
  app.delete('/admin/statuses/:dashboard/:id', { preHandler: adm }, async (req) => { const { id, dashboard } = req.params as { id: string; dashboard: string }; if (adminLevel(req.user!, dashboard) !== 'full') throw forbidden('Full permission required'); return { data: await admin.deleteStatus(id) }; });

  app.get('/admin/lead-sources', { preHandler: adm }, async () => ({ data: await prisma.leadSource.findMany({ orderBy: { order: 'asc' } }) }));
  app.post('/admin/lead-sources', { preHandler: adm }, async (req) => ({ data: await prisma.leadSource.create({ data: z.object({ label: z.string().min(1), order: z.number().optional() }).parse(req.body) }) }));
  app.patch('/admin/lead-sources/:id', { preHandler: adm }, async (req) => { const { id } = req.params as { id: string }; return { data: await prisma.leadSource.update({ where: { id }, data: z.object({ label: z.string().optional(), order: z.number().optional(), active: z.boolean().optional() }).parse(req.body) }) }; });
  app.delete('/admin/lead-sources/:id', { preHandler: adm }, async (req) => { const { id } = req.params as { id: string }; return { data: await prisma.leadSource.update({ where: { id }, data: { active: false } }) }; });

  app.get('/admin/templates', { preHandler: adm }, async () => ({ data: await prisma.template.findMany({ orderBy: [{ channel: 'asc' }, { key: 'asc' }] }) }));
  app.post('/admin/templates', { preHandler: adm }, async (req) => ({ data: await prisma.template.create({ data: z.object({ channel: z.enum(['email', 'whatsapp', 'sms', 'pdf']), key: z.string(), name: z.string(), body: z.string(), variables: z.array(z.string()).default([]) }).parse(req.body) }) }));
  app.patch('/admin/templates/:id', { preHandler: adm }, async (req) => { const { id } = req.params as { id: string }; const before = await prisma.template.findUnique({ where: { id } }); const t = await prisma.template.update({ where: { id }, data: z.object({ name: z.string().optional(), body: z.string().optional(), variables: z.array(z.string()).optional(), active: z.boolean().optional() }).parse(req.body) }); req.audit = { entityType: 'Template', entityId: id, before, after: t }; return { data: t }; });
  app.post('/admin/templates/:id/submit', { preHandler: adm }, async (req) => { const { id } = req.params as { id: string }; return { data: await admin.submitWhatsAppTemplate(id) }; });

  app.get('/admin/messages', { preHandler: adm }, async (req) => { const q = z.object({ lead: z.string().optional(), channel: z.string().optional(), status: z.string().optional(), page: z.coerce.number().default(1) }).parse(req.query); const where: any = {}; if (q.lead) where.leadId = q.lead; if (q.channel) where.channel = q.channel; if (q.status) where.status = q.status; const [total, items] = await Promise.all([prisma.message.count({ where }), prisma.message.findMany({ where, include: { lead: { include: { client: true } } }, orderBy: { queuedAt: 'desc' }, skip: (q.page - 1) * 50, take: 50 })]); return { data: items, meta: { total, page: q.page, pageSize: 50 } }; });
  app.get('/admin/audit', { preHandler: adm }, async (req) => { const q = z.object({ entity: z.string().optional(), entityId: z.string().optional(), user: z.string().optional(), from: z.string().optional(), to: z.string().optional(), page: z.coerce.number().default(1) }).parse(req.query); const where: any = {}; if (q.entity) where.entityType = q.entity; if (q.entityId) where.entityId = q.entityId; if (q.user) where.actorUserId = q.user; if (q.from || q.to) where.at = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) }; const [total, items] = await Promise.all([prisma.auditLog.count({ where }), prisma.auditLog.findMany({ where, orderBy: { at: 'desc' }, skip: (q.page - 1) * 50, take: 50 })]); return { data: items, meta: { total, page: q.page, pageSize: 50 } }; });
  app.get('/admin/ongoing-projects', { preHandler: adm }, async (req) => { const { fromStage } = req.query as { fromStage?: string }; const { STAGES } = await import('@app/shared'); const stages = fromStage ? STAGES.slice(STAGES.indexOf(fromStage as any)) : STAGES; const leads = await prisma.lead.findMany({ where: { archived: false, lostReason: null, stage: { in: stages as any } }, include: { client: true, salesStatus: true, engineerStatus: true, statusHistory: { where: { dashboard: 'stage' }, orderBy: { at: 'asc' } }, delays: { where: { resolvedAt: null } } }, orderBy: { leadDate: 'desc' } }); return { data: leads }; });
  app.get('/admin/lost-leads', { preHandler: adm }, async () => ({ data: await prisma.lead.findMany({ where: { lostReason: { not: null } }, include: { client: true, salesStatus: true, engineerStatus: true, statusHistory: { orderBy: { at: 'desc' }, take: 20 } }, orderBy: { leadDate: 'desc' } }) }));
  app.get('/admin/analytics/:dashboard', { preHandler: adm }, async (req) => { const { dashboard } = req.params as { dashboard: string }; const q = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(req.query); if (adminLevel(req.user!, dashboard) === 'none' && dashboard !== 'global') throw forbidden('No permission'); return { data: await admin.analytics(dashboard, q.from, q.to) }; });

  app.get('/admin/delay-rules', { preHandler: adm }, async () => ({ data: await prisma.delayRule.findMany({ orderBy: [{ dashboard: 'asc' }, { ruleKey: 'asc' }] }) }));
  app.put('/admin/delay-rules', { preHandler: adm }, async (req) => { const b = z.array(z.object({ id: z.string(), thresholdHours: z.number().int().min(1), active: z.boolean() })).parse(req.body); for (const r of b) await prisma.delayRule.update({ where: { id: r.id }, data: { thresholdHours: r.thresholdHours, active: r.active } }); return { data: await prisma.delayRule.findMany() }; });
  app.post('/admin/delays/evaluate', { preHandler: adm }, async () => { await evaluateDelays(); return { data: { ok: true } }; });
  app.get('/admin/notification-rules/:dashboard', { preHandler: adm }, async (req) => { const { dashboard } = req.params as { dashboard: string }; return { data: await prisma.notificationRule.findMany({ where: { dashboard }, orderBy: { eventKey: 'asc' } }) }; });
  app.put('/admin/notification-rules/:dashboard', { preHandler: adm }, async (req) => { const { dashboard } = req.params as { dashboard: string }; const b = z.array(z.object({ eventKey: z.enum(NOTIFICATION_EVENTS), inApp: z.boolean(), email: z.boolean(), whatsapp: z.boolean(), sms: z.boolean(), timingOffsetsMin: z.array(z.number()).default([]) })).parse(req.body); for (const r of b) await prisma.notificationRule.upsert({ where: { dashboard_eventKey: { dashboard, eventKey: r.eventKey } }, create: { dashboard, ...r }, update: r }); return { data: await prisma.notificationRule.findMany({ where: { dashboard } }) }; });

  app.get('/admin/report-schedules', { preHandler: adm }, async () => ({ data: await prisma.reportSchedule.findMany() }));
  app.post('/admin/report-schedules', { preHandler: adm }, async (req) => ({ data: await prisma.reportSchedule.create({ data: z.object({ dashboard: z.string(), frequency: z.enum(['daily', 'weekly', 'monthly']), recipients: z.array(z.string().email()), reportKeys: z.array(z.enum(REPORT_KEYS)) }).parse(req.body) }) }));
  app.patch('/admin/report-schedules/:id', { preHandler: adm }, async (req) => { const { id } = req.params as { id: string }; return { data: await prisma.reportSchedule.update({ where: { id }, data: z.object({ frequency: z.enum(['daily', 'weekly', 'monthly']).optional(), recipients: z.array(z.string().email()).optional(), reportKeys: z.array(z.enum(REPORT_KEYS)).optional(), active: z.boolean().optional() }).parse(req.body) }) }; });

  app.get('/admin/users-locations', { preHandler: adm }, async () => ({ data: await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true, lastLat: true, lastLng: true, lastLocAt: true, lastSeenAt: true } }) }));

  /* view-as: read-only proxy, logged (rule 9.18) */
  app.get('/admin/view-as/:userId/*', { preHandler: adm }, async (req, reply) => {
    const { userId } = req.params as { userId: string }; const rest = (req.params as any)['*'] as string;
    const target = await prisma.user.findUnique({ where: { id: userId } }); if (!target) throw notFound('User');
    await writeAudit({ actorUserId: req.user!.id, actorRole: 'admin', action: 'view_as', entityType: 'User', entityId: userId, after: { path: rest }, ip: req.ip, userAgent: req.headers['user-agent'] });
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const r = await app.inject({ method: 'GET', url: `/api/v1/${rest}${qs}`, headers: { 'x-view-as': userId, cookie: req.headers.cookie ?? '' } });
    return reply.code(r.statusCode).headers({ 'content-type': r.headers['content-type'] as string }).send(r.body);
  });

  app.post('/admin/ai/chat', { preHandler: adm }, async (req, reply) => {
    const { sessionId, message } = z.object({ sessionId: z.string(), message: z.string().min(1) }).parse(req.body);
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': req.headers.origin ?? '*', 'access-control-allow-credentials': 'true' });
    for await (const ev of chat(req.user!.id, sessionId, message)) reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
    reply.raw.end();
    return reply;
  });
  app.post('/admin/backup/run', { preHandler: adm }, async () => ({ data: await admin.runBackup() }));
  app.get('/admin/export/full', { preHandler: adm }, async (req, reply) => { reply.header('content-disposition', 'attachment; filename="full-export.json"'); return { data: await admin.fullExport() }; });
  app.get('/admin/admins', { preHandler: adm }, async () => ({ data: await prisma.user.findMany({ where: { role: 'admin' }, include: { permissions: true } }) }));
}
