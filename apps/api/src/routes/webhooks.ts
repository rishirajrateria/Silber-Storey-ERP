import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db.js';
import { config } from '../config.js';
import { email, sms, whatsapp, storage } from '../integrations/index.js';
import { applyDeliveryStatus } from '../jobs/handlers.js';
import { rt } from '../realtime.js';

export async function webhookRoutes(app: FastifyInstance) {
  app.get('/webhooks/whatsapp', async (req, reply) => { const q = req.query as any; if (q['hub.verify_token'] === config.whatsapp.verifyToken) return reply.send(q['hub.challenge']); return reply.code(403).send('bad token'); });
  app.post('/webhooks/whatsapp', async (req) => { for (const e of whatsapp.parseWebhook(req.body)) await applyDeliveryStatus(e.providerMessageId, e.status, e.at); return { data: { ok: true } }; });
  app.post('/webhooks/sms', async (req) => { for (const e of sms.parseDlr(req.body)) await applyDeliveryStatus(e.providerMessageId, e.status, e.at); return { data: { ok: true } }; });
  app.post('/webhooks/email', async (req) => { for (const e of email.parseEvents(req.body)) await applyDeliveryStatus(e.providerMessageId, e.status, e.at); return { data: { ok: true } }; });
  app.post('/webhooks/meeting-bot', async (req) => {
    const b = req.body as { meetingId: string; recordingUrl?: string; durationSec?: number; participants?: number; data?: string };
    const m = await prisma.meeting.findUnique({ where: { id: b.meetingId } });
    if (!m) return { data: { ok: false } };
    let bytes = 0; const key = `recordings/${m.id}/bot-${Date.now()}.webm`;
    if (b.data) { const buf = Buffer.from(b.data, 'base64'); bytes = (await storage.putStream(key, buf, 'audio/webm')).bytes; }
    else if (b.recordingUrl) { const r = await fetch(b.recordingUrl); const buf = Buffer.from(await r.arrayBuffer()); bytes = (await storage.putStream(key, buf, 'audio/webm')).bytes; }
    await prisma.recording.create({ data: { meetingId: m.id, storageKey: key, source: 'bot', bytes, durationSec: b.durationSec ?? 0, status: bytes > 0 ? 'ready' : 'failed' } });
    if (b.participants === 0 && m.status !== 'completed') await prisma.meeting.update({ where: { id: m.id }, data: { status: 'no_show', noShowMarkedBy: 'bot' } });
    rt.lead(m.leadId, { type: 'recording', meetingId: m.id });
    return { data: { ok: true } };
  });
  app.post('/webhooks/google-calendar', async () => ({ data: { ok: true } }));
}
