import { prisma } from '../lib/db.js';
import { registerJob, enqueue } from './queue.js';
import { ai, email, sms, whatsapp, storage } from '../integrations/index.js';
import { embedDocument } from '../services/rag.js';
import { evaluateDelays } from '../services/delays.js';
import { newToken } from '../lib/tokens.js';
import { sendTemplated } from '../services/messaging.js';
import { notify } from '../services/notifications.js';
import { config } from '../config.js';
import { rt } from '../realtime.js';
import { runScheduledReports } from '../services/reports.js';

/* ---------- outbound message worker (rule 9.16) ---------- */
registerJob('send_message', async (p: any) => {
  if (p.internal) { await email.send(p.to, p.subject, `<p>${p.body}</p>`).catch(() => null); return; }
  const m = await prisma.message.findUnique({ where: { id: p.messageId } });
  if (!m || m.status !== 'queued') return;
  if (m.holdUntil && m.holdUntil > new Date()) { await enqueue('send_message', { messageId: m.id }, m.holdUntil.getTime() - Date.now()); return; }
  try {
    let r;
    const attachment = m.attachmentKey ? await storage.get(m.attachmentKey).catch(() => null) : null;
    if (m.channel === 'email') r = await email.send(m.to, m.subject ?? m.templateKey ?? 'Message', m.body.replace(/\n/g, '<br>'), attachment ? [{ filename: m.attachmentKey!.split('/').pop()!, content: attachment }] : undefined);
    else if (m.channel === 'sms') r = await sms.send(m.to, m.templateKey ?? '', {}, m.body);
    else if (m.channel === 'whatsapp') r = m.attachmentKey ? await whatsapp.sendDocument(m.to, await storage.getSignedUrl(m.attachmentKey), m.body) : await whatsapp.sendTemplate(m.to, m.templateKey ?? '', {}, m.body);
    else return;
    await prisma.message.update({ where: { id: m.id }, data: { status: 'sent', sentAt: new Date(), providerMessageId: r.providerMessageId } });
  } catch (e: any) {
    await prisma.message.update({ where: { id: m.id }, data: { status: 'failed', error: String(e?.message ?? e).slice(0, 500) } });
  }
  if (m.leadId) rt.lead(m.leadId, { type: 'message', id: m.id });
});

export async function applyDeliveryStatus(providerMessageId: string, status: string, at = new Date()) {
  const m = await prisma.message.findFirst({ where: { providerMessageId } });
  if (!m) return;
  const data: any = {};
  if (status === 'delivered' && !m.deliveredAt) { data.status = 'delivered'; data.deliveredAt = at; }
  if (status === 'read') { data.status = 'read'; data.readAt = at; data.deliveredAt = m.deliveredAt ?? at; }
  if (status === 'failed') { data.status = 'failed'; }
  if (Object.keys(data).length) await prisma.message.update({ where: { id: m.id }, data });
  if (m.leadId) rt.lead(m.leadId, { type: 'message', id: m.id });
}
registerJob('mock_delivery', async (p: any) => { await applyDeliveryStatus(p.providerMessageId, p.status); });

registerJob('quiet_hours_release', async () => {
  const due = await prisma.message.findMany({ where: { status: 'queued', holdUntil: { lte: new Date() } }, take: 200 });
  for (const m of due) await enqueue('send_message', { messageId: m.id });
});

/* ---------- mock bot recording (silent webm) ---------- */
registerJob('bot_recording_ready', async (p: any) => {
  const m = await prisma.meeting.findUnique({ where: { id: p.meetingId } });
  if (!m || ['cancelled', 'completed'].includes(m.status)) return;
  const key = `recordings/${m.id}/bot-${Date.now()}.webm`;
  const silent = Buffer.alloc(4096, 0); silent.write('mock-silent-webm', 0);
  await storage.putStream(key, silent, 'audio/webm');
  await prisma.recording.create({ data: { meetingId: m.id, storageKey: key, source: 'bot', bytes: silent.length, durationSec: 60, status: 'ready' } });
  rt.lead(m.leadId, { type: 'recording', meetingId: m.id });
});

/* ---------- AI pipeline (rule 9.6): transcribe → minutes → profile → embed → email MoM ---------- */
registerJob('ai_pipeline', async (p: { meetingId: string; recordingId: string }) => {
  const m = await prisma.meeting.findUnique({ where: { id: p.meetingId }, include: { lead: { include: { client: true, handover: true } }, transcript: true, mom: true } });
  if (!m) return;
  const rec = await prisma.recording.findUnique({ where: { id: p.recordingId } });
  if (!rec) return;
  const transcriptText = m.transcript?.text ?? (await ai.transcribe(rec.storageKey));
  if (!m.transcript) await prisma.transcript.create({ data: { meetingId: m.id, text: transcriptText, model: ai.name } });
  const momText = m.mom?.text ?? (await ai.minutes(transcriptText, { clientName: m.lead.client.name, meetingDate: m.startAt.toDateString(), requirement: m.lead.requirement }));
  const mom = m.mom ?? (await prisma.minutesOfMeeting.create({ data: { meetingId: m.id, text: momText, model: ai.name, token: newToken() } }));
  const profile = await ai.clientProfile(m.lead.aiProfile, transcriptText);
  await prisma.lead.update({ where: { id: m.leadId }, data: { aiProfile: profile } });
  const meta = { meetingDate: m.startAt.toISOString().slice(0, 10) };
  await embedDocument({ docType: 'transcript', docId: m.id, leadId: m.leadId, clientId: m.lead.clientId, text: transcriptText, meta });
  await embedDocument({ docType: 'mom', docId: mom.id, leadId: m.leadId, clientId: m.lead.clientId, text: momText, meta });
  const link = `${config.appUrl}/p/mom/${mom.token}`;
  if (m.kind === 'internal') {
    // Rule 9.12: MoM to engineer, head, junior, admin — no client messages
    const ids = new Set([m.engineerUserId, m.lead.handover?.designHeadUserId, m.lead.handover?.juniorUserId].filter(Boolean) as string[]);
    for (const a of await prisma.user.findMany({ where: { role: 'admin', active: true } })) ids.add(a.id);
    for (const id of ids) { const u = await prisma.user.findUnique({ where: { id } }); if (u) await sendTemplated({ leadId: m.leadId, channel: 'email', templateKey: 'mom_email', to: u.email, subject: `Internal MoM · ${m.lead.client.name ?? ''}`, vars: { client_name: m.lead.client.name ?? '', meeting_datetime: m.startAt.toLocaleString(), mom_link: link, mom_text: momText } }); await notify(id, 'mom_ready', 'Internal meeting minutes ready', m.lead.client.name ?? '', `/design/leads/${m.leadId}`); }
  } else {
    if (m.lead.client.email) {
      await sendTemplated({ leadId: m.leadId, clientId: m.lead.clientId, channel: 'email', templateKey: 'mom_email', to: m.lead.client.email, vars: { client_name: m.lead.client.name ?? 'there', meeting_datetime: m.startAt.toLocaleString(), mom_link: link, mom_text: momText } });
      await prisma.minutesOfMeeting.update({ where: { id: mom.id }, data: { emailedToClientAt: new Date() } });
    }
    await notify(m.engineerUserId, 'mom_ready', 'Minutes of meeting ready', m.lead.client.name ?? '', `/engineer/meetings/${m.id}`);
  }
  rt.lead(m.leadId, { type: 'mom', meetingId: m.id });
});

registerJob('embed_document', async (p: any) => { await embedDocument(p); });

/* ---------- reminders ---------- */
registerJob('reminder', async (p: { meetingId: string; offsetMin: number; startAt: string }) => {
  const m = await prisma.meeting.findUnique({ where: { id: p.meetingId }, include: { lead: { include: { client: true } } } });
  if (!m || m.startAt.toISOString() !== p.startAt || !['scheduled', 'rescheduled'].includes(m.status)) return; // rescheduled: stale reminder
  const { sendToClient3 } = await import('../services/messaging.js');
  if (m.kind !== 'internal') await sendToClient3({ leadId: m.leadId, clientId: m.lead.clientId, client: m.lead.client, templateKey: 'meeting_reminder', vars: { client_name: m.lead.client.name ?? 'there', meeting_datetime: m.startAt.toLocaleString(), meet_link: m.meetLink ?? '', invite_link: `${config.appUrl}/p/invite/${m.inviteToken}`, consent_link: `${config.appUrl}/p/consent/${m.consentToken}` } });
  await notify(m.engineerUserId, 'meeting_reminder', `Meeting in ${p.offsetMin >= 60 ? Math.round(p.offsetMin / 60) + 'h' : p.offsetMin + 'm'}`, m.lead.client.name ?? '', `/engineer/meetings/${m.id}`);
});
registerJob('followup_reminder', async () => {
  const soon = new Date(Date.now() + 30 * 60000);
  const due = await prisma.followUp.findMany({ where: { done: false, dueAt: { lte: soon, gte: new Date(Date.now() - 60000) } }, include: { lead: { include: { client: true } } } });
  for (const f of due) await notify(f.userId, 'followup_due', 'Follow-up due', `${f.lead.client.name ?? f.lead.client.phone} · ${f.priority}`, `/sales/leads/${f.leadId}`);
});

/* ---------- delays, no-show, reports ---------- */
registerJob('evaluate_delays', async () => { await evaluateDelays(); });
registerJob('no_show_check', async () => {
  // Rule 9.17: online meetings where the client never joined (bot reported no participants) by endAt → no_show
  const past = await prisma.meeting.findMany({ where: { type: 'meet', status: { in: ['scheduled', 'rescheduled'] }, endAt: { lt: new Date() } }, include: { recordings: true } });
  for (const m of past) if (!m.inviteAcceptedAt || !m.recordings.some((r) => r.status === 'ready' && r.bytes > 0)) await prisma.meeting.update({ where: { id: m.id }, data: { status: 'no_show', noShowMarkedBy: 'worker' } });
});
registerJob('report_schedules', async () => { await runScheduledReports(); });
