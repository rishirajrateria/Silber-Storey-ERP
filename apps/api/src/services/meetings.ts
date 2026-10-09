import { prisma } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import type { AuthUser } from '../plugins/auth.js';
import { calendar, bot, maps, storage } from '../integrations/index.js';
import { newToken } from '../lib/tokens.js';
import { getSetting } from '../lib/settings.js';
import { sendToClient3 } from './messaging.js';
import { notify, notifyAdmins } from './notifications.js';
import { createApproval, registerApprovalHandler } from './approvals.js';
import { setEngineerStatusByKey, setStage } from './stage.js';
import { enqueue } from '../jobs/queue.js';
import { config } from '../config.js';
import { rt } from '../realtime.js';

const fmt = (d: Date) => d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

async function ownedMeeting(u: AuthUser, id: string) {
  const m = await prisma.meeting.findUnique({ where: { id }, include: { lead: { include: { client: true, handover: true } }, recordings: true } });
  if (!m) throw notFound('Meeting');
  if (u.role === 'engineer' && m.engineerUserId !== u.id) throw forbidden('Not your meeting');
  if (u.role === 'finance') throw forbidden('Finance cannot access meetings');
  if (u.role === 'design_head' || u.role === 'junior_designer') {
    const h = m.lead.handover;
    if (!h || (u.role === 'design_head' ? h.designHeadUserId !== u.id : h.juniorUserId !== u.id)) throw forbidden('Not your lead');
  }
  return m;
}
export { ownedMeeting };

/** Invite + consent messages to client (×3 channels) with fresh tokens (rule 9.16). */
async function sendInviteMessages(meetingId: string, templateKey: 'meeting_invite' | 'meeting_rescheduled') {
  const m = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId }, include: { lead: { include: { client: true } } } });
  const office = await getSetting<any>('officeLat');
  const vars = {
    client_name: m.lead.client.name ?? 'there', meeting_datetime: fmt(m.startAt), meeting_type: m.type, meet_link: m.meetLink ?? '',
    office_directions: m.type === 'office' ? maps.directionsUrl({ lat: Number(office ?? config.office.lat), lng: Number((await getSetting<any>('officeLng')) ?? config.office.lng) }) : '',
    invite_link: `${config.appUrl}/p/invite/${m.inviteToken}`, consent_link: `${config.appUrl}/p/consent/${m.consentToken}`,
  };
  await sendToClient3({ leadId: m.leadId, clientId: m.lead.clientId, client: m.lead.client, templateKey, vars });
}

async function scheduleReminders(meetingId: string, startAt: Date) {
  const rule = await prisma.notificationRule.findUnique({ where: { dashboard_eventKey: { dashboard: 'engineer', eventKey: 'meeting_reminder' } } });
  const offsets = (rule?.timingOffsetsMin as number[] | null) ?? [1440, 60];
  for (const off of offsets) {
    const delay = startAt.getTime() - off * 60000 - Date.now();
    if (delay > 0) await enqueue('reminder', { meetingId, offsetMin: off, startAt: startAt.toISOString() }, delay);
  }
}

export async function createMeeting(u: AuthUser, input: { leadId: string; kind: 'client' | 'internal' | 'second_client'; type: 'meet' | 'office' | 'site'; startAt: string; endAt: string; adminInvited: boolean; attendeeUserIds?: string[] }) {
  const lead = await prisma.lead.findUnique({ where: { id: input.leadId }, include: { client: true, handover: true } });
  if (!lead) throw notFound('Lead');
  if (u.role === 'engineer' && lead.engineerUserId !== u.id) throw forbidden('Not your lead');
  const start = new Date(input.startAt), end = new Date(input.endAt);
  if (!(end > start)) throw badRequest('End must be after start');
  if (input.kind !== 'client' && !lead.pushedToDesignAt) throw conflict('NOT_IN_HANDOVER', 'Internal / second meetings only after push to design');
  if (input.type === 'site' && (lead.client.addressLat == null || lead.client.addressLng == null)) throw conflict('ADDRESS_MISSING', 'Site meeting needs a geocoded exact address');
  const attendees = new Set(input.attendeeUserIds ?? []);
  if (input.kind !== 'client' && lead.handover) { attendees.add(lead.handover.designHeadUserId); if (lead.handover.juniorUserId) attendees.add(lead.handover.juniorUserId); }
  attendees.delete(u.id);
  const attendeeUsers = await prisma.user.findMany({ where: { id: { in: [...attendees] } } });
  const ev = await calendar.createEvent(u.id, { title: `${input.kind === 'internal' ? 'Internal' : 'Client'} meeting · ${lead.client.name ?? lead.client.phone}`, start, end, attendees: attendeeUsers.map((a) => a.email), withMeet: input.type === 'meet', location: input.type === 'site' ? lead.client.exactAddress ?? undefined : input.type === 'office' ? await getSetting<string>('officeAddress') : undefined });
  const calendarEventIds: Record<string, string> = { [u.id]: ev.eventId };
  for (const a of attendeeUsers) { const e = await calendar.addToCalendar(a.id, { title: `Meeting · ${lead.client.name ?? lead.client.phone}`, start, end, withMeet: false }).catch(() => null); if (e) calendarEventIds[a.id] = e.eventId; }
  const meeting = await prisma.meeting.create({
    data: { leadId: lead.id, kind: input.kind, type: input.type, startAt: start, endAt: end, engineerUserId: u.id, attendeeUserIds: [...attendees], adminInvited: input.adminInvited, meetLink: ev.meetLink, calendarEventIds, inviteToken: newToken(), consentToken: newToken(),
      // internal meetings need no client acceptance (rule 9.12)
      inviteAcceptedAt: input.kind === 'internal' ? new Date() : null, consentAcceptedAt: input.kind === 'internal' ? new Date() : null },
  });
  if (input.kind !== 'internal') {
    await sendInviteMessages(meeting.id, 'meeting_invite');
    await scheduleReminders(meeting.id, start);
    await setEngineerStatusByKey(lead.id, 'meeting_set', u.id);
    if (input.kind === 'client') await setStage(lead.id, 'meeting_scheduled', u.id);
  }
  if (input.type === 'meet' && ev.meetLink) await bot.scheduleBot(meeting.id, ev.meetLink, start);
  for (const a of attendeeUsers) await notify(a.id, 'meeting_scheduled', 'Meeting scheduled', `${fmt(start)} · ${lead.client.name ?? ''}`, `/design/leads/${lead.id}`);
  if (input.adminInvited) {
    await createApproval({ type: 'meeting_invite', entityType: 'Meeting', entityId: meeting.id, leadId: lead.id, requestedByUserId: u.id, payload: { startAt: start, endAt: end, type: input.type, clientName: lead.client.name } });
  }
  if (input.kind === 'internal') await prisma.handover.update({ where: { leadId: lead.id }, data: { internalMeetingId: meeting.id } });
  if (input.kind === 'second_client') await prisma.handover.update({ where: { leadId: lead.id }, data: { secondMeetingId: meeting.id } });
  rt.lead(lead.id, { type: 'meeting', id: meeting.id });
  return meeting;
}

/* Rule 9.11: admin invite response */
registerApprovalHandler('meeting_invite', async (a, approve, u, remark) => {
  const m = await prisma.meeting.findUnique({ where: { id: a.entityId }, include: { lead: { include: { client: true } } } });
  if (!m) return;
  const decision = (a.payload?.decision as 'proceed' | 'reschedule') ?? 'proceed';
  await prisma.meeting.update({ where: { id: m.id }, data: { adminResponse: approve ? 'accepted' : 'declined', adminRemark: remark, adminDecision: approve ? 'proceed' : decision } });
  if (approve) await calendar.addToCalendar(u.id, { title: `Client meeting · ${m.lead.client.name ?? m.lead.client.phone}`, start: m.startAt, end: m.endAt, withMeet: false }).catch(() => null);
  await notify(m.engineerUserId, 'admin_invite_response', approve ? 'Admin accepted the meeting invite' : `Admin declined (${decision})`, remark ?? '', `/engineer/meetings/${m.id}`);
});
export async function adminRespond(u: AuthUser, meetingId: string, input: { accept: boolean; remark?: string; decision?: 'proceed' | 'reschedule' }) {
  const a = await prisma.approval.findFirst({ where: { type: 'meeting_invite', entityId: meetingId, status: 'pending' } });
  if (!a) throw conflict('NO_INVITE', 'No pending admin invite for this meeting');
  await prisma.approval.update({ where: { id: a.id }, data: { payload: { ...(a.payload as any), decision: input.decision ?? 'proceed' } } });
  const { decide } = await import('./approvals.js');
  return decide(u, a.id, input.accept, input.remark ?? (input.accept ? 'accepted' : 'declined'));
}

export async function reschedule(u: AuthUser, id: string, input: { startAt: string; endAt: string }) {
  const m = await ownedMeeting(u, id);
  if (!['scheduled', 'rescheduled'].includes(m.status)) throw conflict('BAD_STATE', 'Cannot reschedule this meeting');
  const start = new Date(input.startAt), end = new Date(input.endAt);
  const ids = m.calendarEventIds as Record<string, string>;
  for (const [uid, eid] of Object.entries(ids)) await calendar.updateEvent(uid, eid, { start, end }).catch(() => null);
  // Rule 9.16: invalidate tokens, issue new ones, re-send
  const updated = await prisma.meeting.update({ where: { id }, data: { startAt: start, endAt: end, status: 'rescheduled', inviteToken: newToken(), consentToken: newToken(), inviteAcceptedAt: m.kind === 'internal' ? new Date() : null, consentAcceptedAt: m.kind === 'internal' ? new Date() : null, adminResponse: 'none', adminDecision: null } });
  if (m.kind !== 'internal') { await sendInviteMessages(id, 'meeting_rescheduled'); await scheduleReminders(id, start); }
  if (m.type === 'meet' && m.meetLink) { await bot.cancelBot(id); await bot.scheduleBot(id, m.meetLink, start); }
  for (const uid of m.attendeeUserIds) await notify(uid, 'meeting_rescheduled', 'Meeting rescheduled', fmt(start));
  if (m.adminInvited) await notifyAdmins('meeting_rescheduled', 'Meeting rescheduled', `${m.lead.client.name ?? ''} · ${fmt(start)}`);
  rt.lead(m.leadId, { type: 'meeting', id });
  return updated;
}

export async function cancel(u: AuthUser, id: string) {
  const m = await ownedMeeting(u, id);
  if (['completed', 'cancelled'].includes(m.status)) throw conflict('BAD_STATE', 'Cannot cancel');
  for (const [uid, eid] of Object.entries(m.calendarEventIds as Record<string, string>)) await calendar.deleteEvent(uid, eid).catch(() => null);
  const updated = await prisma.meeting.update({ where: { id }, data: { status: 'cancelled', inviteToken: newToken(), consentToken: newToken() } });
  if (m.kind !== 'internal') await sendToClient3({ leadId: m.leadId, clientId: m.lead.clientId, client: m.lead.client, templateKey: 'meeting_cancelled', vars: { client_name: m.lead.client.name ?? 'there', meeting_datetime: fmt(m.startAt) } });
  if (m.type === 'meet') await bot.cancelBot(id);
  for (const uid of m.attendeeUserIds) await notify(uid, 'meeting_cancelled', 'Meeting cancelled', fmt(m.startAt));
  rt.lead(m.leadId, { type: 'meeting', id });
  return updated;
}

export async function travelStart(u: AuthUser, id: string) {
  const m = await ownedMeeting(u, id);
  if (m.type !== 'site') throw conflict('NOT_SITE', 'Travel only for site meetings');
  return prisma.meeting.update({ where: { id }, data: { travelStartedAt: m.travelStartedAt ?? new Date() } });
}

/* Rule 9.5 */
export async function checkin(u: AuthUser, id: string, lat: number, lng: number) {
  const m = await ownedMeeting(u, id);
  if (m.type !== 'site') throw conflict('NOT_SITE', 'Check-in only for site meetings');
  if (!m.travelStartedAt) throw conflict('TRAVEL_NOT_STARTED', 'Start travel first');
  const c = m.lead.client;
  if (c.addressLat == null || c.addressLng == null) throw conflict('ADDRESS_MISSING', 'Client address not geocoded');
  const radius = Number(await getSetting('checkinRadiusM')) || 200;
  const distanceM = Math.round(maps.distanceM({ lat, lng }, { lat: c.addressLat, lng: c.addressLng }));
  if (distanceM > radius) throw conflict('OUT_OF_RANGE', `You are ${distanceM} m away (limit ${radius} m)`, { distanceM, radius });
  await prisma.locationTrack.create({ data: { userId: u.id, meetingId: id, lat, lng } });
  return prisma.meeting.update({ where: { id }, data: { checkinAt: new Date(), checkinLat: lat, checkinLng: lng, checkinDistanceM: distanceM } });
}

/* Rule 9.4 */
export async function start(u: AuthUser, id: string) {
  const m = await ownedMeeting(u, id);
  if (!['scheduled', 'rescheduled'].includes(m.status)) throw conflict('BAD_STATE', `Meeting is ${m.status}`);
  if (!m.inviteAcceptedAt) throw conflict('INVITE_PENDING', 'Client has not accepted the invite');
  if (!m.consentAcceptedAt) throw conflict('CONSENT_PENDING', 'Client has not given recording consent');
  if (m.type === 'site' && !m.checkinAt) throw conflict('CHECKIN_REQUIRED', 'Check in at the site first');
  return prisma.meeting.update({ where: { id }, data: { status: 'in_progress' } });
}

/* Recording upload: chunked, idempotent */
export async function recordingInit(u: AuthUser, id: string) {
  await ownedMeeting(u, id);
  const rec = await prisma.recording.create({ data: { meetingId: id, storageKey: `recordings/${id}/${Date.now()}.webm`, source: 'mic', status: 'uploading' } });
  return { uploadId: rec.id };
}
export async function recordingChunk(u: AuthUser, id: string, uploadId: string, n: number, data: Buffer) {
  await ownedMeeting(u, id);
  const rec = await prisma.recording.findFirst({ where: { id: uploadId, meetingId: id } });
  if (!rec) throw notFound('Upload');
  await storage.putStream(`${rec.storageKey}.part${n}`, data);
  return { ok: true, n };
}
export async function recordingComplete(u: AuthUser, id: string, uploadId: string, chunks: number, checksum?: string) {
  await ownedMeeting(u, id);
  const rec = await prisma.recording.findFirst({ where: { id: uploadId, meetingId: id } });
  if (!rec) throw notFound('Upload');
  const parts: Buffer[] = [];
  for (let i = 0; i < chunks; i++) parts.push(await storage.get(`${rec.storageKey}.part${i}`).catch(() => Buffer.alloc(0)));
  const all = Buffer.concat(parts);
  await storage.putStream(rec.storageKey, all, 'audio/webm');
  for (let i = 0; i < chunks; i++) await storage.delete(`${rec.storageKey}.part${i}`).catch(() => null);
  return prisma.recording.update({ where: { id: uploadId }, data: { bytes: all.length, checksum, status: all.length > 0 ? 'ready' : 'failed' } });
}

/* Rule 9.6 */
export async function complete(u: AuthUser, id: string) {
  const m = await ownedMeeting(u, id);
  if (!['in_progress', 'scheduled', 'rescheduled'].includes(m.status)) throw conflict('BAD_STATE', `Meeting is ${m.status}`);
  const ready = m.recordings.find((r) => r.status === 'ready' && r.bytes > 0 && !r.deletedAt);
  if (!ready) throw conflict('RECORDING_MISSING', 'A recording (mic or bot) must be uploaded before completing');
  const durationSec = Math.max(1, Math.round((Date.now() - Math.max(m.startAt.getTime(), m.checkinAt?.getTime() ?? 0)) / 1000));
  const updated = await prisma.meeting.update({ where: { id }, data: { status: 'completed', durationSec } });
  if (m.kind === 'client') await setStage(m.leadId, 'meeting_done', u.id);
  if (m.kind === 'internal') await setStage(m.leadId, 'internal_meeting_done', u.id);
  if (m.kind === 'second_client') await setStage(m.leadId, 'second_client_meeting_done', u.id);
  await enqueue('ai_pipeline', { meetingId: id, recordingId: ready.id });
  rt.lead(m.leadId, { type: 'meeting', id });
  return updated;
}

export async function noShow(u: AuthUser, id: string) {
  const m = await ownedMeeting(u, id);
  if (['completed', 'cancelled'].includes(m.status)) throw conflict('BAD_STATE', 'Cannot mark no-show');
  return prisma.meeting.update({ where: { id }, data: { status: 'no_show', noShowMarkedBy: u.id } });
}

export async function recordingUrl(u: AuthUser, id: string) {
  const m = await ownedMeeting(u, id);
  const r = m.recordings.find((x) => x.status === 'ready' && !x.deletedAt);
  if (!r) throw notFound('Recording');
  return { url: await storage.getSignedUrl(r.storageKey) };
}

/* ---------- public token pages (5.10, rule 9.21) ---------- */
export async function publicInvite(token: string) {
  const m = await prisma.meeting.findUnique({ where: { inviteToken: token }, include: { lead: { include: { client: true } } } });
  if (!m || m.status === 'cancelled' || m.endAt < new Date()) throw notFound('Invite');
  const branding = await getSetting<any>('branding');
  return { meeting: { id: m.id, type: m.type, startAt: m.startAt, endAt: m.endAt, meetLink: m.meetLink, inviteAcceptedAt: m.inviteAcceptedAt, officeAddress: m.type === 'office' ? await getSetting('officeAddress') : undefined }, clientName: m.lead.client.name, company: branding?.companyName, consentToken: m.consentToken };
}
export async function publicInviteAccept(token: string) {
  const m = await prisma.meeting.findUnique({ where: { inviteToken: token } });
  if (!m || m.status === 'cancelled' || m.endAt < new Date()) throw notFound('Invite');
  const upd = await prisma.meeting.update({ where: { id: m.id }, data: { inviteAcceptedAt: m.inviteAcceptedAt ?? new Date() } });
  await notify(m.engineerUserId, 'invite_accepted', 'Client accepted the invite', '', `/engineer/meetings/${m.id}`);
  return { inviteAcceptedAt: upd.inviteAcceptedAt };
}
export async function publicInviteReschedule(token: string, preferredSlots: string[]) {
  const m = await prisma.meeting.findUnique({ where: { inviteToken: token }, include: { lead: { include: { client: true } } } });
  if (!m || m.endAt < new Date()) throw notFound('Invite');
  await prisma.note.create({ data: { leadId: m.leadId, meetingId: m.id, text: `Client requested reschedule. Preferred slots: ${preferredSlots.join(', ')}`, byUserId: m.engineerUserId } });
  await notify(m.engineerUserId, 'meeting_rescheduled', 'Client asked to reschedule', preferredSlots.join(', '), `/engineer/meetings/${m.id}`);
  return { ok: true };
}
export async function publicConsent(token: string) {
  const m = await prisma.meeting.findUnique({ where: { consentToken: token }, include: { lead: { include: { client: true } } } });
  if (!m || m.status === 'cancelled' || m.endAt < new Date()) throw notFound('Consent');
  return { meeting: { id: m.id, startAt: m.startAt, consentAcceptedAt: m.consentAcceptedAt }, clientName: m.lead.client.name, company: (await getSetting<any>('branding'))?.companyName };
}
export async function publicConsentAccept(token: string) {
  const m = await prisma.meeting.findUnique({ where: { consentToken: token } });
  if (!m || m.status === 'cancelled' || m.endAt < new Date()) throw notFound('Consent');
  const upd = await prisma.meeting.update({ where: { id: m.id }, data: { consentAcceptedAt: m.consentAcceptedAt ?? new Date() } });
  await notify(m.engineerUserId, 'consent_accepted', 'Client gave recording consent', '', `/engineer/meetings/${m.id}`);
  return { consentAcceptedAt: upd.consentAcceptedAt };
}
export async function publicMom(token: string) {
  const mom = await prisma.minutesOfMeeting.findUnique({ where: { token }, include: { meeting: { include: { lead: { include: { client: true } } } }, objections: true } });
  if (!mom) throw notFound('Minutes');
  return { text: mom.text, meetingDate: mom.meeting.startAt, clientName: mom.meeting.lead.client.name, company: (await getSetting<any>('branding'))?.companyName, objections: mom.objections.map((o) => ({ remark: o.remark, at: o.at })) };
}
export async function publicMomObjection(token: string, remark: string, ip: string) {
  const mom = await prisma.minutesOfMeeting.findUnique({ where: { token }, include: { meeting: true } });
  if (!mom) throw notFound('Minutes');
  const o = await prisma.objection.create({ data: { momId: mom.id, remark, ip } });
  await notify(mom.meeting.engineerUserId, 'objection_raised', 'Client objected to the MoM', remark.slice(0, 200), `/engineer/meetings/${mom.meetingId}`);
  await notifyAdmins('objection_raised', 'Client objected to the MoM', remark.slice(0, 200), `/admin/projects`);
  return o;
}
