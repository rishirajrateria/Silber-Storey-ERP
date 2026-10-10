import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { PaymentSchema } from '@app/shared';
import { requireRole } from '../plugins/auth.js';
import * as f from '../services/finance.js';
import { LEAD_INCLUDE, serializeLead } from '../services/leads.js';
import { streamFile } from './quotes.js';

export async function financeRoutes(app: FastifyInstance) {
  const fin = requireRole('finance');
  app.get('/finance/leads', { preHandler: fin }, async (req) => ({ data: (await prisma.lead.findMany({ where: { pushedToFinanceAt: { not: null }, archived: false }, include: { ...LEAD_INCLUDE, pipeline: { include: { milestones: { include: { invoice: { include: { payments: true } } }, orderBy: { order: 'asc' } } } } }, orderBy: { pushedToFinanceAt: 'desc' } })).map((l) => serializeLead(req.user!, l)) }));
  app.get('/leads/:id/pipeline', { preHandler: requireRole('finance', 'engineer', 'admin') }, async (req) => { const { id } = req.params as { id: string }; return { data: await f.pipeline(req.user!, id) }; });
  app.patch('/milestones/:id', { preHandler: fin }, async (req) => { const { id } = req.params as { id: string }; return { data: await f.patchMilestone(req.user!, id, z.object({ dueDate: z.string().nullable().optional(), amount: z.number().optional() }).parse(req.body)) }; });
  app.post('/milestones/:id/request-pct-change', { preHandler: fin }, async (req) => { const { id } = req.params as { id: string }; const b = z.object({ newPct: z.number().min(0).max(100), reason: z.string().min(1) }).parse(req.body); return { data: await f.requestPctChange(req.user!, id, b.newPct, b.reason) }; });
  app.post('/leads/:id/push-back-to-engineer', { preHandler: fin }, async (req) => { const { id } = req.params as { id: string }; const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body); return { data: await f.pushBackToEngineer(req.user!, id, reason) }; });
  app.post('/milestones/:id/invoice', { preHandler: fin }, async (req, reply) => { const { id } = req.params as { id: string }; const i = await f.createInvoice(req.user!, id); req.audit = { entityType: 'Invoice', entityId: i.id, after: i }; return reply.code(201).send({ data: i }); });
  app.post('/invoices/:id/send', { preHandler: fin }, async (req) => { const { id } = req.params as { id: string }; return { data: await f.sendInvoice(req.user!, id) }; });
  app.post('/invoices/:id/payments', { preHandler: fin }, async (req, reply) => { const { id } = req.params as { id: string }; const r = await f.recordPayment(req.user!, id, PaymentSchema.parse(req.body)); req.audit = { entityType: 'Payment', entityId: r.payment.id, after: r.payment }; return reply.code(201).send({ data: r }); });
  app.post('/invoices/:id/credit-note', { preHandler: fin }, async (req) => { const { id } = req.params as { id: string }; const b = z.object({ amount: z.number().positive(), reason: z.string().min(1) }).parse(req.body); return { data: await f.requestCreditNote(req.user!, id, b.amount, b.reason) }; });
  app.post('/invoices/:id/cancel-request', { preHandler: fin }, async (req) => { const { id } = req.params as { id: string }; const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body); return { data: await f.requestCancellation(req.user!, id, reason) }; });
  app.get('/invoices/:id', { preHandler: requireRole('finance', 'engineer', 'admin') }, async (req) => { const { id } = req.params as { id: string }; return { data: await prisma.invoice.findUnique({ where: { id }, include: { payments: { include: { receipt: true } }, creditNotes: true } }) }; });
  app.get('/invoices/:id/pdf', { preHandler: requireRole('finance', 'engineer', 'admin') }, async (req, reply) => { const { id } = req.params as { id: string }; return streamFile(reply, await f.invoicePdfKey(id), `invoice-${id}.pdf`); });
  app.get('/receipts/:id/pdf', { preHandler: requireRole('finance', 'engineer', 'admin') }, async (req, reply) => { const { id } = req.params as { id: string }; return streamFile(reply, await f.receiptPdfKey(id), `receipt-${id}.pdf`); });
}
