import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { config } from '../config.js';
import { AppError, forbidden } from '../lib/errors.js';
import { COOKIE, sessions } from '../plugins/session.js';
import { requireAuth, requireRole } from '../plugins/auth.js';
import { getAllSettings } from '../lib/settings.js';
import { writeAudit } from '../lib/audit.js';
import { rt } from '../realtime.js';

const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: config.appUrl.startsWith('https'), maxAge: 60 * 60 * 24 * 14 };

export async function authRoutes(app: FastifyInstance) {
  /** Login rule (Section 2): session only if User exists, active, with a role. */
  async function login(reply: any, email: string, ip: string, ua: string, extra: { refreshToken?: string } = {}) {
    const u = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!u || !u.active || !u.role) throw new AppError(403, 'NOT_AUTHORISED', 'Not authorised — ask Admin to add you.');
    if (extra.refreshToken) await prisma.user.update({ where: { id: u.id }, data: { googleRefreshTokenEnc: extra.refreshToken } });
    const s = await sessions.create(u.id, ip, ua);
    reply.setCookie(COOKIE, s.sid, cookieOpts);
    await writeAudit({ actorUserId: u.id, actorRole: u.role, action: 'login', entityType: 'User', entityId: u.id, ip, userAgent: ua });
    return u;
  }

  app.get('/auth/google/start', async (req, reply) => {
    if (config.mockMode || !config.google.clientId) return reply.redirect(`${config.appUrl}/login?mock=1`);
    const params = new URLSearchParams({ client_id: config.google.clientId, redirect_uri: `${config.apiUrl}/api/v1/auth/google/callback`, response_type: 'code', scope: 'openid email profile https://www.googleapis.com/auth/calendar', access_type: 'offline', prompt: 'consent', hd: config.google.workspaceDomain });
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });
  app.get('/auth/google/callback', async (req, reply) => {
    const { code } = req.query as { code?: string };
    if (!code) throw new AppError(400, 'BAD_REQUEST', 'Missing code');
    const tr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: `${config.apiUrl}/api/v1/auth/google/callback`, grant_type: 'authorization_code' }) });
    const tok: any = await tr.json();
    const ui = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tok.access_token}` } });
    const info: any = await ui.json();
    if (config.google.workspaceDomain && info.hd !== config.google.workspaceDomain) return reply.redirect(`${config.appUrl}/login?error=NOT_AUTHORISED`);
    try { await login(reply, info.email, req.ip, req.headers['user-agent'] ?? '', { refreshToken: tok.refresh_token }); }
    catch { return reply.redirect(`${config.appUrl}/login?error=NOT_AUTHORISED`); }
    return reply.redirect(config.appUrl);
  });
  /** MOCK_MODE only: pick a seeded user by email (DECISIONS.md). */
  app.post('/auth/dev-login', async (req, reply) => {
    if (!config.mockMode) throw forbidden('Dev login disabled');
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const u = await login(reply, email, req.ip, req.headers['user-agent'] ?? '');
    return { data: { id: u.id, email: u.email, role: u.role } };
  });
  app.get('/auth/dev-users', async () => { if (!config.mockMode) throw forbidden('Dev login disabled'); return { data: await prisma.user.findMany({ where: { active: true }, select: { email: true, name: true, role: true }, orderBy: { role: 'asc' } }) }; });
  app.post('/auth/logout', async (req, reply) => { if (req.session) await sessions.destroy(req.session.sid); reply.clearCookie(COOKIE, { path: '/' }); return { data: { ok: true } }; });

  app.get('/me', { preHandler: requireAuth }, async (req) => {
    const s = await getAllSettings();
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    return { data: { user: req.user, locationConsentAt: u.locationConsentAt, settings: { branding: s.branding, checkinRadiusM: s.checkinRadiusM, officeAddress: s.officeAddress, officeLat: s.officeLat, officeLng: s.officeLng, quoteValidityDays: s.quoteValidityDays, gstPct: s.gstPct }, mockMode: config.mockMode } };
  });
  app.post('/me/location-consent', { preHandler: requireAuth }, async (req) => ({ data: await prisma.user.update({ where: { id: req.user!.id }, data: { locationConsentAt: new Date() }, select: { locationConsentAt: true } }) }));
  app.post('/me/location', { preHandler: requireAuth }, async (req) => {
    const { lat, lng, meetingId } = z.object({ lat: z.number(), lng: z.number(), meetingId: z.string().optional() }).parse(req.body);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!u.locationConsentAt) throw new AppError(409, 'CONSENT_REQUIRED', 'Location consent required');
    await prisma.user.update({ where: { id: u.id }, data: { lastLat: lat, lastLng: lng, lastLocAt: new Date() } });
    // Rule 9.5: tracking points only between travel-start and complete
    if (meetingId) { const m = await prisma.meeting.findUnique({ where: { id: meetingId } }); if (m && m.travelStartedAt && m.status !== 'completed') await prisma.locationTrack.create({ data: { userId: u.id, meetingId, lat, lng } }); }
    rt.location({ userId: u.id, name: u.name, role: u.role, lat, lng, at: new Date() });
    return { data: { ok: true } };
  });
  app.get('/sessions/me', { preHandler: requireAuth }, async (req) => ({ data: (await sessions.listByUser(req.user!.id)).map((s) => ({ sid: s.sid.slice(0, 8) + '…', full: s.sid, deviceId: s.deviceId, ip: s.ip, ua: s.ua, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.sid === req.session?.sid })) }));
  app.delete('/sessions/:sid', { preHandler: requireAuth }, async (req) => {
    const { sid } = req.params as { sid: string };
    const s = await sessions.get(sid);
    if (s && (s.userId === req.user!.id || req.user!.role === 'admin')) await sessions.destroy(sid);
    return { data: { ok: true } };
  });
  app.get('/notifications', { preHandler: requireAuth }, async (req) => { const { unread } = req.query as { unread?: string }; return { data: await prisma.notification.findMany({ where: { userId: req.user!.id, ...(unread ? { readAt: null } : {}) }, orderBy: { at: 'desc' }, take: 50 }) }; });
  app.post('/notifications/:id/read', { preHandler: requireAuth }, async (req) => { const { id } = req.params as { id: string }; await prisma.notification.updateMany({ where: { id, userId: req.user!.id }, data: { readAt: new Date() } }); return { data: { ok: true } }; });
  app.post('/notifications/read-all', { preHandler: requireAuth }, async (req) => { await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } }); return { data: { ok: true } }; });
  app.get('/users/directory', { preHandler: requireRole('all') }, async () => ({ data: await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true, email: true } }) }));
}
