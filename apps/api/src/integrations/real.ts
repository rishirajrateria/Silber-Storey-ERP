import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as s3Sign } from '@aws-sdk/s3-request-presigner';
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { haversineM } from '../lib/geo.js';
import { prisma } from '../lib/db.js';
import type { AIProvider, CalendarProvider, EmailProvider, MapsProvider, MeetingBotProvider, PdfRenderer, SmsProvider, StorageProvider, WhatsAppProvider } from './types.js';
import { renderDocumentHtml } from '../services/documents/html.js';

/* ---------- Google Calendar (REST, refresh-token flow) ---------- */
async function googleAccessToken(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u?.googleRefreshTokenEnc) throw new Error('No Google refresh token for user');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.google.clientId, client_secret: config.google.clientSecret, refresh_token: u.googleRefreshTokenEnc, grant_type: 'refresh_token' }),
  });
  const j: any = await r.json();
  if (!j.access_token) throw new Error('Google token refresh failed');
  return { token: j.access_token as string, calendarId: u.calendarId ?? 'primary' };
}
const gcal = async (userId: string, path: string, init: RequestInit = {}) => {
  const { token, calendarId } = await googleAccessToken(userId);
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`Google Calendar ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};
export const realCalendar: CalendarProvider = {
  async createEvent(userId, ev) {
    const body: any = { summary: ev.title, description: ev.description, location: ev.location, start: { dateTime: ev.start.toISOString() }, end: { dateTime: ev.end.toISOString() }, attendees: ev.attendees?.map((email) => ({ email })) };
    if (ev.withMeet) body.conferenceData = { createRequest: { requestId: Math.random().toString(36).slice(2), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
    const j: any = await gcal(userId, `/events?conferenceDataVersion=1`, { method: 'POST', body: JSON.stringify(body) });
    return { eventId: j.id, meetLink: j.hangoutLink };
  },
  async updateEvent(userId, eventId, ev) {
    const body: any = {};
    if (ev.title) body.summary = ev.title; if (ev.start) body.start = { dateTime: ev.start.toISOString() }; if (ev.end) body.end = { dateTime: ev.end.toISOString() };
    await gcal(userId, `/events/${eventId}`, { method: 'PATCH', body: JSON.stringify(body) });
  },
  async deleteEvent(userId, eventId) { await gcal(userId, `/events/${eventId}`, { method: 'DELETE' }); },
  async freeBusy(userId, from, to) {
    const { token, calendarId } = await googleAccessToken(userId);
    const r = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: calendarId }] }) });
    const j: any = await r.json();
    return (j.calendars?.[calendarId]?.busy ?? []).map((b: any) => ({ start: new Date(b.start), end: new Date(b.end) }));
  },
  async addToCalendar(userId, ev) { const r = await this.createEvent(userId, ev); return { eventId: r.eventId }; },
};

/* ---------- Meeting bot (generic REST contract) ---------- */
export const realBot: MeetingBotProvider = {
  async scheduleBot(meetingId, meetLink, startAt) {
    const r = await fetch('https://api.meeting-bot.example/v1/bots', { method: 'POST', headers: { authorization: `Bearer ${config.meetingBotKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ meetingId, meetLink, joinAt: startAt.toISOString(), webhook: `${config.apiUrl}/api/v1/webhooks/meeting-bot` }) });
    const j: any = await r.json(); return { botId: j.id };
  },
  async cancelBot(meetingId) { await fetch(`https://api.meeting-bot.example/v1/bots/${meetingId}`, { method: 'DELETE', headers: { authorization: `Bearer ${config.meetingBotKey}` } }); },
};

/* ---------- Gemini ---------- */
const gemini = async (model: string, body: unknown) => {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j: any = await r.json();
  return j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
};
export const realAI: AIProvider = {
  name: 'gemini-1.5-pro',
  async transcribe(audioKey) {
    const { storage } = await import('./index.js');
    const buf = await storage.get(audioKey);
    return gemini('gemini-1.5-pro', { contents: [{ parts: [{ text: 'Transcribe this meeting audio to English text with speaker labels.' }, { inlineData: { mimeType: 'audio/webm', data: buf.toString('base64') } }] }] });
  },
  async minutes(transcript, ctx) { return gemini('gemini-1.5-pro', { contents: [{ parts: [{ text: `Write concise minutes of meeting (summary, decisions, action items) for client ${ctx.clientName}. Transcript:\n${transcript}` }] }] }); },
  async clientProfile(prev, transcript) { return gemini('gemini-1.5-flash', { contents: [{ parts: [{ text: `Previous profile:\n${prev ?? 'none'}\nUpdate the client profile (preferences, budget, decision style) from this transcript:\n${transcript}` }] }] }); },
  async embed(texts) {
    const out: number[][] = [];
    for (const t of texts) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${config.geminiKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: { parts: [{ text: t }] } }) });
      const j: any = await r.json(); out.push(j.embedding?.values ?? []);
    }
    return out;
  },
  async *chat(messages, tools) {
    const q = messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
    const docs = (await tools.search_documents({ query: q, filters: {} })) as any[];
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const prompt = `${system}\n\nContext documents:\n${docs.map((d, i) => `[${i + 1}] (${d.docType}, lead ${d.leadId}, ${d.clientName}) ${d.text}`).join('\n\n')}\n\nQuestion: ${q}`;
    const text = await gemini('gemini-1.5-pro', { contents: [{ parts: [{ text: prompt }] }] });
    yield { delta: text };
    yield { citations: docs.slice(0, 5).map((d) => ({ docType: d.docType, leadId: d.leadId, clientName: d.clientName, meetingDate: d.meetingDate, versionNo: d.versionNo, quotedLine: d.text.split('\n')[0].slice(0, 160) })) };
  },
};

/* ---------- WhatsApp Cloud API ---------- */
export const realWhatsApp: WhatsAppProvider = {
  async sendTemplate(to, key, vars) {
    const r = await fetch(`https://graph.facebook.com/v19.0/${config.whatsapp.phoneId}/messages`, { method: 'POST', headers: { authorization: `Bearer ${config.whatsapp.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: { name: key, language: { code: 'en' }, components: [{ type: 'body', parameters: Object.values(vars).map((v) => ({ type: 'text', text: v })) }] } }) });
    const j: any = await r.json(); return { providerMessageId: j.messages?.[0]?.id ?? '' };
  },
  async sendDocument(to, pdfUrl, caption) {
    const r = await fetch(`https://graph.facebook.com/v19.0/${config.whatsapp.phoneId}/messages`, { method: 'POST', headers: { authorization: `Bearer ${config.whatsapp.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'document', document: { link: pdfUrl, caption } }) });
    const j: any = await r.json(); return { providerMessageId: j.messages?.[0]?.id ?? '' };
  },
  async submitTemplate() { return { providerStatus: 'submitted' }; },
  parseWebhook(p: any) {
    const out: any[] = [];
    for (const e of p?.entry ?? []) for (const c of e.changes ?? []) for (const s of c.value?.statuses ?? []) out.push({ providerMessageId: s.id, status: s.status, at: new Date(Number(s.timestamp) * 1000) });
    return out;
  },
};

/* ---------- SMS (generic DLT HTTP provider) ---------- */
export const realSms: SmsProvider = {
  async send(to, _key, _vars, body) {
    const r = await fetch('https://api.sms-provider.example/send', { method: 'POST', headers: { authorization: `Bearer ${config.sms.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ sender: config.sms.senderId, to, text: body }) });
    const j: any = await r.json(); return { providerMessageId: j.id ?? '' };
  },
  parseDlr(p: any) { return Array.isArray(p?.events) ? p.events.map((s: any) => ({ providerMessageId: s.id, status: s.status, at: new Date() })) : []; },
};

/* ---------- Email (SMTP) ---------- */
export const realEmail: EmailProvider = {
  async send(to, subject, html, attachments) {
    const t = nodemailer.createTransport({ host: config.email.host, port: config.email.port, secure: config.email.port === 465, auth: { user: config.email.user, pass: config.email.pass } });
    const info = await t.sendMail({ from: config.email.from, to, subject, html, attachments });
    return { providerMessageId: info.messageId };
  },
  parseEvents(p: any) { return Array.isArray(p?.events) ? p.events.map((s: any) => ({ providerMessageId: s.id, status: s.status, at: new Date() })) : []; },
};

/* ---------- Google Maps ---------- */
export const realMaps: MapsProvider = {
  async geocode(address) {
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${config.google.mapsKey}`);
    const j: any = await r.json(); const loc = j.results?.[0]?.geometry?.location;
    return loc ? { lat: loc.lat, lng: loc.lng } : null;
  },
  directionsUrl(o) { return `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}`; },
  distanceM: haversineM,
};

/* ---------- S3 ---------- */
const s3 = () => new S3Client({ region: config.s3.region, endpoint: config.s3.endpoint, forcePathStyle: !!config.s3.endpoint, credentials: { accessKeyId: config.s3.accessKey, secretAccessKey: config.s3.secretKey } });
export const s3Storage: StorageProvider = {
  async putStream(key, data, mime) {
    const buf = Buffer.isBuffer(data) ? data : await (async () => { const c: Buffer[] = []; for await (const x of data as any) c.push(Buffer.from(x)); return Buffer.concat(c); })();
    await s3().send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: buf, ContentType: mime }));
    return { bytes: buf.length };
  },
  async get(key) { const r = await s3().send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key })); return Buffer.from(await r.Body!.transformToByteArray()); },
  async getSignedUrl(key, ttlSec = 900) { return s3Sign(s3(), new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }), { expiresIn: ttlSec }); },
  async delete(key) { await s3().send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key })); },
};

/* ---------- PDF via Playwright ---------- */
export const playwrightPdf: PdfRenderer = {
  async render(templateKey, data, outKey) {
    const html = await renderDocumentHtml(templateKey, data);
    const pw: any = await import('playwright' as string).catch(() => { throw new Error('playwright not installed; set MOCK_MODE=true or add playwright'); });
    const browser = await pw.chromium.launch();
    try {
      const page = await browser.newPage(); await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true });
      const { storage } = await import('./index.js'); await storage.putStream(outKey, pdf, 'application/pdf');
    } finally { await browser.close(); }
    return outKey;
  },
};
