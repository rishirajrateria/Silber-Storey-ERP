import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { haversineM } from '../lib/geo.js';
import type { AIProvider, CalendarProvider, EmailProvider, MapsProvider, MeetingBotProvider, PdfRenderer, SmsProvider, StorageProvider, WhatsAppProvider } from './types.js';
import { renderDocumentHtml } from '../services/documents/html.js';

const id = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

export const mockCalendar: CalendarProvider = {
  async createEvent(_u, ev) { return { eventId: id('evt'), meetLink: ev.withMeet ? `https://meet.google.com/mock-${Math.random().toString(36).slice(2, 5)}` : undefined }; },
  async updateEvent() {},
  async deleteEvent() {},
  async freeBusy() { return []; },
  async addToCalendar() { return { eventId: id('evt') }; },
};

/** Mock bot: emits a "recording ready" webhook ~5 s after scheduling (handled in jobs). */
export const mockBot: MeetingBotProvider = {
  async scheduleBot(meetingId) { const { enqueue } = await import('../jobs/queue.js'); await enqueue('bot_recording_ready', { meetingId }, 5000); return { botId: id('bot') }; },
  async cancelBot() {},
};

const hashVec = (text: string, dim = 768) => {
  const v = new Array(dim).fill(0);
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  for (const w of words) { const h = createHash('sha256').update(w).digest(); for (let i = 0; i < 8; i++) v[h[i * 2] * 3 % dim] += (h[i * 2 + 1] / 255) - 0.5; }
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / n);
};

export const mockAI: AIProvider = {
  name: 'mock-gemini',
  async transcribe(audioKey) { return `[Mock transcript for ${audioKey}]\nClient: We want a 2BHK interior with modular kitchen and two wardrobes.\nEngineer: Budget expectations?\nClient: Around 12 lakh, timeline 3 months.\nEngineer: We will share a quote in two days.`; },
  async minutes(transcript, ctx) {
    return `Minutes of Meeting\nClient: ${ctx.clientName ?? ''}\nDate: ${ctx.meetingDate ?? ''}\n\nSummary:\n- Requirement: modular kitchen, wardrobes, false ceiling.\n- Budget discussed: ~12 lakh.\n- Timeline: 3 months.\n\nAction items:\n- Engineer to share quote v1.\n\n(Generated from transcript of ${transcript.length} chars)`;
  },
  async clientProfile(prev, transcript) { return `${prev ? prev + '\n' : ''}Profile update: decisive, budget-conscious (~12 lakh), prefers modern finishes. [${transcript.length} chars analysed]`; },
  async embed(texts) { return texts.map((t) => hashVec(t)); },
  async *chat(messages, tools) {
    const q = messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
    const results = (await tools.search_documents?.({ query: q, filters: {} })) as any[] | undefined;
    const citations = (results ?? []).slice(0, 3).map((r) => ({ docType: r.docType, leadId: r.leadId, clientName: r.clientName, meetingDate: r.meetingDate, versionNo: r.versionNo, quotedLine: r.text.split('\n')[0].slice(0, 160) }));
    const answer = citations.length
      ? `Here is what I found for "${q}":\n` + citations.map((c, i) => `${i + 1}. ${c.quotedLine} (${c.docType}, ${c.clientName ?? 'unknown client'})`).join('\n')
      : `I could not find anything in the documents for "${q}".`;
    for (const chunk of answer.match(/.{1,40}/gs) ?? []) yield { delta: chunk };
    yield { citations };
  },
};

const scheduleStatus = async (providerMessageId: string) => {
  const { enqueue } = await import('../jobs/queue.js');
  await enqueue('mock_delivery', { providerMessageId, status: 'delivered' }, 2000);
  await enqueue('mock_delivery', { providerMessageId, status: 'read' }, 10000);
};
export const mockWhatsApp: WhatsAppProvider = {
  async sendTemplate() { const providerMessageId = id('wa'); await scheduleStatus(providerMessageId); return { providerMessageId }; },
  async sendDocument() { const providerMessageId = id('wa'); await scheduleStatus(providerMessageId); return { providerMessageId }; },
  async submitTemplate() { return { providerStatus: 'approved' }; },
  parseWebhook(p: any) { return Array.isArray(p?.statuses) ? p.statuses.map((s: any) => ({ providerMessageId: s.id, status: s.status, at: new Date() })) : []; },
};
export const mockSms: SmsProvider = {
  async send() { const providerMessageId = id('sms'); await scheduleStatus(providerMessageId); return { providerMessageId }; },
  parseDlr(p: any) { return Array.isArray(p?.events) ? p.events.map((s: any) => ({ providerMessageId: s.id, status: s.status, at: new Date() })) : []; },
};
export const mockEmail: EmailProvider = {
  async send() { const providerMessageId = id('em'); await scheduleStatus(providerMessageId); return { providerMessageId }; },
  parseEvents(p: any) { return Array.isArray(p?.events) ? p.events.map((s: any) => ({ providerMessageId: s.id, status: s.status, at: new Date() })) : []; },
};
export const mockMaps: MapsProvider = {
  async geocode(address) { const h = createHash('md5').update(address).digest(); return { lat: config.office.lat + (h[0] - 128) / 5000, lng: config.office.lng + (h[1] - 128) / 5000 }; },
  directionsUrl(o) { return `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}`; },
  distanceM: haversineM,
};

const root = path.resolve(config.storageDir);
const safe = (key: string) => path.join(root, key.replace(/[^a-zA-Z0-9/_.-]/g, '_'));
export const fsStorage: StorageProvider = {
  async putStream(key, data) {
    const p = safe(key); await fs.mkdir(path.dirname(p), { recursive: true });
    const buf = Buffer.isBuffer(data) ? data : await streamToBuffer(data);
    await fs.writeFile(p, buf); return { bytes: buf.length };
  },
  async get(key) { return fs.readFile(safe(key)); },
  async getSignedUrl(key) { return `${config.apiUrl}/api/v1/storage/${encodeURIComponent(key)}?sig=mock`; },
  async delete(key) { await fs.rm(safe(key), { force: true }); },
};
async function streamToBuffer(s: NodeJS.ReadableStream) { const chunks: Buffer[] = []; for await (const c of s) chunks.push(Buffer.from(c)); return Buffer.concat(chunks); }

/** Mock PDF: stores the rendered HTML under the pdf key (browser renders it fine). */
export const mockPdf: PdfRenderer = {
  async render(templateKey, data, outKey) { const html = await renderDocumentHtml(templateKey, data); await fsStorage.putStream(outKey, Buffer.from(html), 'text/html'); return outKey; },
};
