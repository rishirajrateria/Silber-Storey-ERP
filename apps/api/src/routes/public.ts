import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as m from '../services/meetings.js';
import * as q from '../services/quotes.js';
import * as f from '../services/finance.js';
import { streamFile } from './quotes.js';

/** Section 5.10: token in path, no auth, rate-limited (30/min/IP), no PII in query. Tokens never logged (see app.ts logger redaction). */
export async function publicRoutes(app: FastifyInstance) {
  const rl = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const tok = (req: any) => (req.params as { token: string }).token;
  app.get('/p/invite/:token', rl, async (req) => ({ data: await m.publicInvite(tok(req)) }));
  app.post('/p/invite/:token/accept', rl, async (req) => ({ data: await m.publicInviteAccept(tok(req), req.ip) }));
  app.get('/p/invite/:token/ics', rl, async (req, reply) => { reply.header('content-type', 'text/calendar; charset=utf-8').header('content-disposition', 'attachment; filename="meeting.ics"'); return reply.send(await m.publicInviteIcs(tok(req))); });
  app.post('/p/invite/:token/reschedule', rl, async (req) => ({ data: await m.publicInviteReschedule(tok(req), z.object({ preferredSlots: z.array(z.string()).min(1) }).parse(req.body).preferredSlots) }));
  app.get('/p/consent/:token', rl, async (req) => ({ data: await m.publicConsent(tok(req)) }));
  app.post('/p/consent/:token/accept', rl, async (req) => ({ data: await m.publicConsentAccept(tok(req), req.ip) }));
  app.get('/p/mom/:token', rl, async (req) => ({ data: await m.publicMom(tok(req)) }));
  app.post('/p/mom/:token/objection', rl, async (req) => ({ data: await m.publicMomObjection(tok(req), z.object({ remark: z.string().min(1) }).parse(req.body).remark, req.ip) }));
  app.get('/p/quote/:token', rl, async (req) => ({ data: await q.publicQuote(tok(req)) }));
  app.get('/p/quote/:token/pdf', rl, async (req, reply) => streamFile(reply, await q.publicQuotePdfKey(tok(req)), 'quote.pdf'));
  app.post('/p/quote/:token/accept', rl, async (req) => ({ data: await q.publicQuoteAccept(tok(req)) }));
  app.post('/p/quote/:token/request-changes', rl, async (req) => ({ data: await q.publicQuoteRequestChanges(tok(req), z.object({ remark: z.string().min(1) }).parse(req.body).remark) }));
  app.get('/p/invoice/:token', rl, async (req) => ({ data: await f.publicInvoice(tok(req)) }));
  app.get('/p/invoice/:token/pdf', rl, async (req, reply) => streamFile(reply, await f.publicInvoicePdfKey(tok(req)), 'invoice.pdf'));
  app.get('/p/receipt/:token', rl, async (req) => ({ data: await f.publicReceipt(tok(req)) }));
  app.get('/p/receipt/:token/pdf', rl, async (req, reply) => streamFile(reply, await f.publicReceiptPdfKey(tok(req)), 'receipt.pdf'));
}
