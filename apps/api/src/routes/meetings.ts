import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { CreateMeetingSchema } from '@app/shared';
import { requireRole } from '../plugins/auth.js';
import * as m from '../services/meetings.js';
import { forbidden, notFound } from '../lib/errors.js';

export async function meetingRoutes(app: FastifyInstance) {
  const eng = requireRole('engineer');
  app.post('/meetings', { preHandler: eng }, async (req, reply) => { const r = await m.createMeeting(req.user!, CreateMeetingSchema.parse(req.body)); req.audit = { entityType: 'Meeting', entityId: r.id, after: r }; return reply.code(201).send({ data: r }); });
  app.patch('/meetings/:id/reschedule', { preHandler: eng }, async (req) => { const { id } = req.params as { id: string }; return { data: await m.reschedule(req.user!, id, z.object({ startAt: z.string().datetime(), endAt: z.string().datetime() }).parse(req.body)) }; });
  app.post('/meetings/:id/cancel', { preHandler: eng }, async (req) => { const { id } = req.params as { id: string }; return { data: await m.cancel(req.user!, id) }; });
  app.post('/meetings/:id/admin-respond', { preHandler: requireRole('admin') }, async (req) => { const { id } = req.params as { id: string }; return { data: await m.adminRespond(req.user!, id, z.object({ accept: z.boolean(), remark: z.string().optional(), decision: z.enum(['proceed', 'reschedule']).optional() }).parse(req.body)) }; });
  app.post('/meetings/:id/travel-start', { preHandler: eng }, async (req) => { const { id } = req.params as { id: string }; return { data: await m.travelStart(req.user!, id) }; });
  app.post('/meetings/:id/checkin', { preHandler: eng }, async (req) => { const { id } = req.params as { id: string }; const b = z.object({ lat: z.number(), lng: z.number() }).parse(req.body); return { data: await m.checkin(req.user!, id, b.lat, b.lng) }; });
  app.post('/meetings/:id/start', { preHandler: eng }, async (req) => { const { id } = req.params as { id: string }; return { data: await m.start(req.user!, id) }; });
  app.post('/meetings/:id/recording/init', { preHandler: eng }, async (req) => { const { id } = req.params as { id: string }; return { data: await m.recordingInit(req.user!, id) }; });
  app.put('/meetings/:id/recording/chunk/:n', { preHandler: eng }, async (req) => {
    const { id, n } = req.params as { id: string; n: string }; const { uploadId } = req.query as { uploadId: string };
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : '');
    return { data: await m.recordingChunk(req.user!, id, uploadId, Number(n), body) };
  });
  app.post('/meetings/:id/recording/complete', { preHandler: eng }, async (req) => { const { id } = req.params as { id: string }; const b = z.object({ uploadId: z.string(), chunks: z.number().int().min(0), checksum: z.string().optional() }).parse(req.body); return { data: await m.recordingComplete(req.user!, id, b.uploadId, b.chunks, b.checksum) }; });
  app.post('/meetings/:id/complete', { preHandler: eng }, async (req) => { const { id } = req.params as { id: string }; return { data: await m.complete(req.user!, id) }; });
  app.post('/meetings/:id/no-show', { preHandler: eng }, async (req) => { const { id } = req.params as { id: string }; return { data: await m.noShow(req.user!, id) }; });
  app.get('/meetings', { preHandler: requireRole('engineer', 'design_head', 'junior_designer', 'admin') }, async (req) => {
    const q = z.object({ from: z.string().optional(), to: z.string().optional(), leadId: z.string().optional() }).parse(req.query);
    const where: any = {};
    if (q.leadId) where.leadId = q.leadId;
    if (q.from || q.to) where.startAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
    if (req.user!.role === 'engineer') where.engineerUserId = req.user!.id;
    if (req.user!.role === 'design_head') where.lead = { handover: { designHeadUserId: req.user!.id } };
    if (req.user!.role === 'junior_designer') where.lead = { handover: { juniorUserId: req.user!.id } };
    return { data: await prisma.meeting.findMany({ where, include: { lead: { include: { client: true } }, recordings: true, transcript: { select: { id: true } }, mom: { select: { id: true } } }, orderBy: { startAt: 'asc' } }) };
  });
  app.get('/meetings/:id', { preHandler: requireRole('engineer', 'design_head', 'junior_designer', 'admin') }, async (req) => {
    const { id } = req.params as { id: string };
    const mm = await m.ownedMeeting(req.user!, id);
    const full = await prisma.meeting.findUnique({ where: { id }, include: { lead: { include: { client: true } }, recordings: true, transcript: { select: { id: true, createdAt: true } }, mom: { select: { id: true, createdAt: true, emailedToClientAt: true, objections: true } }, notes: true } });
    const data: any = full;
    if (req.user!.role === 'junior_designer') { delete data.lead.client.phone; delete data.lead.client.email; }
    return { data: { ...data, pendingAdminInvite: mm.adminInvited && mm.adminResponse === 'none' } };
  });
  app.get('/meetings/:id/recording', { preHandler: requireRole('engineer', 'design_head', 'junior_designer', 'admin') }, async (req) => { const { id } = req.params as { id: string }; return { data: await m.recordingUrl(req.user!, id) }; });
  app.get('/meetings/:id/transcript', { preHandler: requireRole('engineer', 'design_head', 'junior_designer', 'admin') }, async (req) => { const { id } = req.params as { id: string }; await m.ownedMeeting(req.user!, id); const t = await prisma.transcript.findUnique({ where: { meetingId: id } }); if (!t) throw notFound('Transcript'); return { data: t }; });
  app.get('/meetings/:id/mom', { preHandler: requireRole('engineer', 'design_head', 'junior_designer', 'admin') }, async (req) => { const { id } = req.params as { id: string }; await m.ownedMeeting(req.user!, id); const t = await prisma.minutesOfMeeting.findUnique({ where: { meetingId: id }, include: { objections: true } }); if (!t) throw notFound('Minutes'); const { token, ...rest } = t; return { data: rest }; });
  app.get('/meetings/:id/tracks', { preHandler: requireRole('admin', 'engineer') }, async (req) => { const { id } = req.params as { id: string }; const mm = await m.ownedMeeting(req.user!, id); if (req.user!.role === 'engineer' && mm.engineerUserId !== req.user!.id) throw forbidden(); return { data: await prisma.locationTrack.findMany({ where: { meetingId: id }, orderBy: { at: 'asc' } }) }; });
}
