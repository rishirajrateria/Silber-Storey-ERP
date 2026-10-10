import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { BillingSchema, CreateLeadSchema, LogContactSchema, PatchLeadSchema, StatusChangeSchema, PRIORITIES, ROLES } from '@app/shared';
import { requireRole, adminLevel } from '../plugins/auth.js';
import * as leads from '../services/leads.js';
import { createApproval } from '../services/approvals.js';
import { logManualContact } from '../services/messaging.js';
import { storage, calendar } from '../integrations/index.js';
import { forbidden, notFound, badRequest } from '../lib/errors.js';
import * as admin from '../services/admin.js';
import { canViewCalendar } from '../services/handover.js';
import { rt } from '../realtime.js';

export async function leadRoutes(app: FastifyInstance) {
  app.get('/leads', { preHandler: requireRole('all') }, async (req) => {
    const q = z.object({ dashboard: z.string().optional(), status: z.string().optional(), stage: z.string().optional(), q: z.string().optional(), page: z.coerce.number().min(1).default(1), pageSize: z.coerce.number().min(1).max(200).default(25), lost: z.string().optional(), archived: z.string().optional() }).parse(req.query);
    const where: any = { ...leads.scopeWhere(req.user!, q.dashboard), archived: q.archived === '1' ? true : false };
    if (q.status) where.OR = [{ salesStatus: { key: q.status } }, { engineerStatus: { key: q.status } }];
    if (q.stage) where.stage = q.stage;
    if (q.lost === '1') where.lostReason = { not: null };
    if (q.q) where.client = { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }, { email: { contains: q.q, mode: 'insensitive' } }] };
    const [total, items] = await Promise.all([prisma.lead.count({ where }), prisma.lead.findMany({ where, include: leads.LEAD_INCLUDE, orderBy: { leadDate: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize })]);
    return { data: items.map((l) => leads.serializeLead(req.user!, l)), meta: { total, page: q.page, pageSize: q.pageSize } };
  });
  app.post('/leads', { preHandler: requireRole('sales') }, async (req, reply) => {
    const b = CreateLeadSchema.parse(req.body);
    const l = await leads.createLead(req.user!, b);
    req.audit = { entityType: 'Lead', entityId: l.id, after: l };
    return reply.code(201).send({ data: l });
  });
  app.post('/leads/duplicate-override', { preHandler: requireRole('sales') }, async (req) => {
    const b = CreateLeadSchema.parse(req.body);
    const existing = await prisma.client.findUnique({ where: { phone: b.phone } });
    if (!existing) throw badRequest('No duplicate exists for this phone; create the lead directly');
    return { data: await createApproval({ type: 'duplicate_override', entityType: 'Client', entityId: existing.id, requestedByUserId: req.user!.id, payload: b }) };
  });
  app.get('/leads/:id', { preHandler: requireRole('all') }, async (req) => {
    const { id } = req.params as { id: string };
    const l = await prisma.lead.findFirst({ where: { id, ...leads.scopeWhere(req.user!) }, include: { ...leads.LEAD_INCLUDE, meetings: { orderBy: { startAt: 'desc' } }, followUps: { where: { done: false }, orderBy: { dueAt: 'asc' } } } });
    if (!l) throw notFound('Lead');
    return { data: leads.serializeLead(req.user!, l) };
  });
  app.patch('/leads/:id', { preHandler: requireRole('engineer', 'sales') }, async (req) => { const { id } = req.params as { id: string }; const before = await leads.getScopedLead(req.user!, id); const l = await leads.patchLead(req.user!, id, PatchLeadSchema.parse(req.body)); req.audit = { entityType: 'Lead', entityId: id, before, after: l }; return { data: l }; });
  app.put('/leads/:id/billing', { preHandler: requireRole('engineer') }, async (req) => {
    const { id } = req.params as { id: string }; await leads.getScopedLead(req.user!, id);
    const b = BillingSchema.parse(req.body);
    const before = await prisma.billingDetails.findUnique({ where: { leadId: id } });
    const r = await prisma.billingDetails.upsert({ where: { leadId: id }, create: { leadId: id, ...b }, update: b });
    req.audit = { entityType: 'BillingDetails', entityId: id, before, after: r };
    return { data: r };
  });
  app.post('/leads/:id/status', { preHandler: requireRole('sales', 'engineer') }, async (req) => { const { id } = req.params as { id: string }; const before = await leads.getScopedLead(req.user!, id); const l = await leads.changeStatus(req.user!, id, StatusChangeSchema.parse(req.body)); req.audit = { entityType: 'Lead', entityId: id, before: { salesStatusId: before.salesStatusId, engineerStatusId: before.engineerStatusId }, after: { salesStatusId: l.salesStatusId, engineerStatusId: l.engineerStatusId } }; return { data: l }; });
  app.post('/leads/:id/genuine', { preHandler: requireRole('sales') }, async (req) => { const { id } = req.params as { id: string }; const { genuine } = z.object({ genuine: z.boolean() }).parse(req.body); return { data: await leads.setGenuine(req.user!, id, genuine) }; });
  app.post('/leads/:id/transfer-to-engineer', { preHandler: requireRole('sales') }, async (req) => { const { id } = req.params as { id: string }; const { engineerUserId } = z.object({ engineerUserId: z.string().optional() }).parse(req.body ?? {}); return { data: await leads.transferToEngineer(req.user!, id, engineerUserId) }; });
  app.post('/leads/:id/revive', { preHandler: requireRole('sales', 'engineer', 'admin') }, async (req) => { const { id } = req.params as { id: string }; const { statusId } = z.object({ statusId: z.string() }).parse(req.body); return { data: await leads.revive(req.user!, id, statusId) }; });
  app.post('/leads/:id/reassign', { preHandler: requireRole('admin') }, async (req) => { const { id } = req.params as { id: string }; const b = z.object({ role: z.enum(ROLES), userId: z.string() }).parse(req.body); return { data: await leads.reassign(req.user!, id, b.role, b.userId) }; });
  app.post('/leads/:id/archive', { preHandler: requireRole('admin') }, async (req) => { const { id } = req.params as { id: string }; return { data: await admin.archiveLead(id) }; });
  app.post('/leads/:id/delete', { preHandler: requireRole('admin') }, async (req) => { const { id } = req.params as { id: string }; return { data: await admin.deleteLead(id) }; });
  app.post('/leads/:id/close-project', { preHandler: requireRole('admin') }, async (req) => { const { id } = req.params as { id: string }; const { keepRecordings } = z.object({ keepRecordings: z.boolean() }).parse(req.body); return { data: await admin.closeProject(req.user!, id, keepRecordings) }; });
  app.get('/leads/:id/timeline', { preHandler: requireRole('all') }, async (req) => { const { id } = req.params as { id: string }; return { data: await leads.timeline(req.user!, id) }; });
  app.get('/leads/:id/roadmap', { preHandler: requireRole('admin') }, async (req) => { const { id } = req.params as { id: string }; return { data: await leads.roadmap(id) }; });
  app.post('/leads/:id/log-contact', { preHandler: requireRole('sales', 'engineer', 'finance') }, async (req) => {
    const { id } = req.params as { id: string }; const b = LogContactSchema.parse(req.body);
    const l = await leads.getScopedLead(req.user!, id);
    const ch = b.channel.startsWith('manual_') ? b.channel : (`manual_${b.channel === 'email' ? 'email' : b.channel === 'whatsapp' ? 'whatsapp' : 'call'}` as any);
    // first contact by engineer → stage first_contact
    if (req.user!.role === 'engineer' && l.transferredToEngineerAt) { const { setStage } = await import('../services/stage.js'); await setStage(id, 'first_contact', req.user!.id); }
    return { data: await logManualContact(id, l.clientId, ch, b.note, req.user!.id, ch === 'manual_email' ? l.client.email ?? '' : l.client.phone) };
  });
  const noteRoles = requireRole('engineer', 'design_head', 'junior_designer', 'admin');
  app.get('/leads/:id/notes', { preHandler: noteRoles }, async (req) => { const { id } = req.params as { id: string }; await leads.getScopedLead(req.user!, id); return { data: await prisma.note.findMany({ where: { leadId: id }, orderBy: { at: 'desc' } }) }; });
  app.post('/leads/:id/notes', { preHandler: noteRoles }, async (req) => { const { id } = req.params as { id: string }; await leads.getScopedLead(req.user!, id); const { text, meetingId } = z.object({ text: z.string().min(1), meetingId: z.string().optional() }).parse(req.body); const n = await prisma.note.create({ data: { leadId: id, meetingId, text, byUserId: req.user!.id } }); rt.lead(id, { type: 'note' }); return { data: n }; });
  app.get('/leads/:id/files', { preHandler: noteRoles }, async (req) => { const { id } = req.params as { id: string }; await leads.getScopedLead(req.user!, id); return { data: await prisma.leadFile.findMany({ where: { leadId: id }, orderBy: { at: 'desc' } }) }; });
  app.post('/leads/:id/files', { preHandler: noteRoles }, async (req) => {
    const { id } = req.params as { id: string }; await leads.getScopedLead(req.user!, id);
    const file = await req.file();
    if (!file) throw badRequest('No file');
    const buf = await file.toBuffer();
    const key = `files/${id}/${Date.now()}-${file.filename.replace(/[^\w.-]/g, '_')}`;
    await storage.putStream(key, buf, file.mimetype);
    const f = await prisma.leadFile.create({ data: { leadId: id, name: file.filename, storageKey: key, mime: file.mimetype, bytes: buf.length, byUserId: req.user!.id } });
    rt.lead(id, { type: 'file' });
    return { data: f };
  });
  app.get('/leads/:id/files/:fileId', { preHandler: noteRoles }, async (req) => { const { id, fileId } = req.params as { id: string; fileId: string }; await leads.getScopedLead(req.user!, id); const f = await prisma.leadFile.findFirst({ where: { id: fileId, leadId: id } }); if (!f) throw notFound('File'); return { data: { url: await storage.getSignedUrl(f.storageKey), name: f.name } }; });
  app.delete('/leads/:id/files/:fileId', { preHandler: noteRoles }, async (req) => { const { id, fileId } = req.params as { id: string; fileId: string }; await leads.getScopedLead(req.user!, id); const f = await prisma.leadFile.findFirst({ where: { id: fileId, leadId: id } }); if (!f) throw notFound('File'); await storage.delete(f.storageKey).catch(() => null); await prisma.leadFile.delete({ where: { id: fileId } }); return { data: { ok: true } }; });
  app.get('/leads/:id/export.zip', { preHandler: requireRole('admin') }, async (req, reply) => { const { id } = req.params as { id: string }; reply.header('content-type', 'application/zip').header('content-disposition', `attachment; filename="lead-${id}.zip"`); return reply.send(await admin.exportLeadZip(id)); });

  app.get('/clients', { preHandler: requireRole('admin') }, async (req) => { const { q } = req.query as { q?: string }; return { data: await prisma.client.findMany({ where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } : {}, include: { _count: { select: { leads: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }) }; });
  app.get('/clients/:id', { preHandler: requireRole('admin') }, async (req) => { const { id } = req.params as { id: string }; const c = await prisma.client.findUnique({ where: { id }, include: { leads: { include: leads.LEAD_INCLUDE, orderBy: { leadDate: 'desc' } } } }); if (!c) throw notFound('Client'); return { data: c }; });
  app.delete('/clients/:id', { preHandler: requireRole('admin') }, async (req) => { const { id } = req.params as { id: string }; const { confirmation } = z.object({ confirmation: z.string() }).parse(req.body ?? {}); return { data: await admin.deleteClient(id, confirmation) }; });

  /* follow-ups & calendar (5.3) */
  app.get('/followups', { preHandler: requireRole('all') }, async (req) => {
    const q = z.object({ me: z.string().optional(), from: z.string().optional(), to: z.string().optional(), done: z.string().optional() }).parse(req.query);
    const where: any = {};
    if (q.me || req.user!.role !== 'admin') where.userId = req.user!.id;
    if (q.from || q.to) where.dueAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
    if (q.done !== '1') where.done = false;
    return { data: await prisma.followUp.findMany({ where, include: { lead: { include: { client: true, salesStatus: true, engineerStatus: true } } }, orderBy: { dueAt: 'asc' } }) };
  });
  app.patch('/followups/:id', { preHandler: requireRole('all') }, async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ done: z.boolean().optional(), dueAt: z.string().datetime().optional(), priority: z.enum(PRIORITIES).optional() }).parse(req.body);
    const f = await prisma.followUp.findUnique({ where: { id } });
    if (!f || (f.userId !== req.user!.id && req.user!.role !== 'admin')) throw forbidden('Not your follow-up');
    if (b.dueAt && f.calendarEventId) await calendar.updateEvent(f.userId, f.calendarEventId, { start: new Date(b.dueAt), end: new Date(new Date(b.dueAt).getTime() + 1800000) }).catch(() => null);
    return { data: await prisma.followUp.update({ where: { id }, data: { done: b.done, doneAt: b.done ? new Date() : b.done === false ? null : undefined, dueAt: b.dueAt ? new Date(b.dueAt) : undefined, priority: b.priority } }) };
  });
  const calendarFor = async (userId: string, from: Date, to: Date) => {
    const [meetings, followUps, busy] = await Promise.all([
      prisma.meeting.findMany({ where: { startAt: { gte: from, lte: to }, status: { notIn: ['cancelled'] }, OR: [{ engineerUserId: userId }, { attendeeUserIds: { has: userId } }] }, include: { lead: { include: { client: true } } } }),
      prisma.followUp.findMany({ where: { userId, dueAt: { gte: from, lte: to } }, include: { lead: { include: { client: true } } } }),
      calendar.freeBusy(userId, from, to).catch(() => []),
    ]);
    const { getSetting } = await import('../lib/settings.js');
    const { maps } = await import('../integrations/index.js');
    const office = { lat: Number(await getSetting('officeLat')), lng: Number(await getSetting('officeLng')) };
    const withTravel = meetings.map((m) => { const c = m.lead.client; if (m.type !== 'site' || c.addressLat == null || c.addressLng == null) return { ...m, travelMin: null, distanceKm: null }; const km = maps.distanceM(office, { lat: c.addressLat, lng: c.addressLng }) / 1000; return { ...m, distanceKm: +km.toFixed(1), travelMin: Math.round((km / 22) * 60) + 5 }; });
    return { meetings: withTravel, followUps, busy };
  };
  app.get('/calendar/me', { preHandler: requireRole('all') }, async (req) => { const q = z.object({ from: z.string(), to: z.string() }).parse(req.query); return { data: await calendarFor(req.user!.id, new Date(q.from), new Date(q.to)) }; });
  app.get('/calendar/user/:userId', { preHandler: requireRole('engineer', 'admin') }, async (req) => {
    const { userId } = req.params as { userId: string }; const q = z.object({ from: z.string(), to: z.string() }).parse(req.query);
    if (!(await canViewCalendar(req.user!, userId))) throw forbidden('Calendar visible only while a lead is in transfer to this user');
    const d = await calendarFor(userId, new Date(q.from), new Date(q.to));
    // free/busy only for other users (rule 9.13): strip client details
    return { data: { busy: [...d.busy, ...d.meetings.map((m) => ({ start: m.startAt, end: m.endAt })), ...d.followUps.map((f) => ({ start: f.dueAt, end: new Date(f.dueAt.getTime() + 1800000) }))] } };
  });
  app.get('/statuses', { preHandler: requireRole('all') }, async () => ({ data: await prisma.leadStatus.findMany({ where: { active: true }, orderBy: [{ dashboard: 'asc' }, { order: 'asc' }] }) }));
  app.get('/lead-sources', { preHandler: requireRole('all') }, async () => ({ data: await prisma.leadSource.findMany({ where: { active: true }, orderBy: { order: 'asc' } }) }));
  app.get('/stats', { preHandler: requireRole('all') }, async (req) => { const { stats } = await import('../services/reports.js'); const { dashboard } = req.query as { dashboard?: string }; const d = dashboard ?? req.user!.role; if (req.user!.role === 'admin' && dashboard && adminLevel(req.user!, dashboard) === 'none') throw forbidden('No permission'); return { data: await stats(d, req.user!.role === 'admin' ? undefined : req.user!.id) }; });
  app.get('/reports/:key.csv', { preHandler: requireRole('all') }, async (req, reply) => {
    const { key } = req.params as { key: string }; const q = z.object({ dashboard: z.string().optional(), from: z.string().optional(), to: z.string().optional() }).parse(req.query);
    const { reportCsv } = await import('../services/reports.js');
    const isAdmin = req.user!.role === 'admin';
    const dashboard = isAdmin ? q.dashboard : req.user!.role;
    reply.header('content-type', 'text/csv').header('content-disposition', `attachment; filename="${key}.csv"`);
    return reply.send(await reportCsv(key, { dashboard, from: q.from, to: q.to, userId: isAdmin ? undefined : req.user!.id }));
  });
}
