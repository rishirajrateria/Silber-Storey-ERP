import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../plugins/auth.js';
import * as q from '../services/quotes.js';
import { getSetting } from '../lib/settings.js';
import { storage } from '../integrations/index.js';

export const streamFile = async (reply: any, key: string, name: string) => {
  const buf = await storage.get(key);
  const isHtml = buf.subarray(0, 15).toString().toLowerCase().startsWith('<!doctype html');
  reply.header('content-type', isHtml ? 'text/html; charset=utf-8' : 'application/pdf').header('content-disposition', `inline; filename="${name}"`);
  return reply.send(buf);
};

export async function quoteRoutes(app: FastifyInstance) {
  const eng = requireRole('engineer');
  app.get('/leads/:id/quote', { preHandler: requireRole('engineer', 'finance', 'admin') }, async (req) => { const { id } = req.params as { id: string }; return { data: await q.getQuote(req.user!, id) }; });
  app.post('/leads/:id/quote/versions', { preHandler: eng }, async (req, reply) => { const { id } = req.params as { id: string }; const b = z.object({ data: z.unknown(), paymentSchedule: z.unknown(), approvalRequired: z.boolean().optional(), isFinal: z.boolean().optional() }).parse(req.body) as { data: unknown; paymentSchedule: unknown; approvalRequired?: boolean; isFinal?: boolean }; const v = await q.createVersion(req.user!, id, b); req.audit = { entityType: 'QuoteVersion', entityId: v.id, after: { versionNo: v.versionNo, total: v.total } }; return reply.code(201).send({ data: v }); });
  app.post('/quote-versions/:vid/mark-final', { preHandler: eng }, async (req) => { const { vid } = req.params as { vid: string }; return { data: await q.markFinal(req.user!, vid) }; });
  app.post('/quote-versions/:vid/request-approval', { preHandler: eng }, async (req) => { const { vid } = req.params as { vid: string }; return { data: await q.requestApproval(req.user!, vid) }; });
  app.post('/quote-versions/:vid/send', { preHandler: eng }, async (req) => { const { vid } = req.params as { vid: string }; return { data: await q.send(req.user!, vid) }; });
  app.post('/quote-versions/:vid/mark-accepted', { preHandler: eng }, async (req) => { const { vid } = req.params as { vid: string }; return { data: await q.markAccepted(req.user!, vid) }; });
  app.get('/quote-versions/:vid/pdf', { preHandler: requireRole('engineer', 'finance', 'admin') }, async (req, reply) => { const { vid } = req.params as { vid: string }; return streamFile(reply, await q.pdfKeyFor(req.user!, vid), `quote-${vid}.pdf`); });
  app.get('/quote-versions/:vid/diff', { preHandler: requireRole('engineer', 'admin') }, async (req) => { const { vid } = req.params as { vid: string }; return { data: await q.versionDiff(req.user!, vid) }; });
  app.get('/settings/rate-card', { preHandler: requireRole('engineer', 'admin') }, async () => ({ data: { rateCard: await getSetting('rateCard'), gstPct: await getSetting('gstPct'), quoteValidityDays: await getSetting('quoteValidityDays') } }));
  app.post('/leads/:id/push-to-finance', { preHandler: eng }, async (req) => { const { id } = req.params as { id: string }; return { data: await q.pushToFinance(req.user!, id) }; });
}
