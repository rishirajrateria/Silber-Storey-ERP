import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config } from './config.js';
import { AppError } from './lib/errors.js';
import { loadUser } from './plugins/auth.js';
import { registerAuditHook } from './plugins/audit.js';
import { initSessionStore, sessions } from './plugins/session.js';
import { prisma } from './lib/db.js';
import { storage } from './integrations/index.js';
import './jobs/handlers.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { leadRoutes } from './routes/leads.js';
import { meetingRoutes } from './routes/meetings.js';
import { quoteRoutes } from './routes/quotes.js';
import { financeRoutes } from './routes/finance.js';
import { designRoutes } from './routes/design.js';
import { approvalRoutes } from './routes/approvals.js';
import { adminRoutes } from './routes/admin.js';
import { publicRoutes } from './routes/public.js';
import { webhookRoutes } from './routes/webhooks.js';

export async function buildApp() {
  await initSessionStore();
  const app = Fastify({
    logger: config.isTest ? false : { level: 'info', redact: { paths: ['req.headers.cookie'], censor: '[redacted]' }, serializers: { req: (r) => ({ method: r.method, url: r.url.replace(/\/p\/(\w+)\/[a-f0-9]{64}/g, '/p/$1/[token]').replace(/token=[^&]+/g, 'token=[redacted]') }) } },
    bodyLimit: 1024 * 1024 * 1024, trustProxy: true,
  });
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_r, body, done) => done(null, body));
  await app.register(cors, { origin: [config.appUrl, /localhost:\d+$/], credentials: true });
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(multipart, { limits: { fileSize: Number.MAX_SAFE_INTEGER } });
  await app.register(rateLimit, { global: false });

  app.addHook('preHandler', async (req) => {
    await loadUser(req);
    // admin view-as (internal inject only): impersonate read-only
    const viewAs = req.headers['x-view-as'] as string | undefined;
    if (viewAs && req.user?.role === 'admin' && req.method === 'GET') {
      const u = await prisma.user.findUnique({ where: { id: viewAs }, include: { permissions: true } });
      if (u) req.user = { id: u.id, email: u.email, name: u.name, role: u.role as any, permissions: [] };
    }
  });
  registerAuditHook(app);

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    if (err instanceof ZodError) return reply.code(400).send({ error: { code: 'VALIDATION', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), details: err.issues } });
    if (err.statusCode === 429) return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    if (err.code === 'P2025') return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    if (err.code === 'P2002') return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Already exists' } });
    req.log.error(err);
    return reply.code(err.statusCode ?? 500).send({ error: { code: 'INTERNAL', message: config.isTest ? String(err.message) : 'Something went wrong' } });
  });

  app.get('/health', async () => ({ ok: true, mock: config.mockMode }));
  // local storage passthrough (mock signed URLs)
  app.get('/api/v1/storage/*', async (req, reply) => {
    const key = decodeURIComponent((req.params as any)['*']);
    if (!req.user && !key.startsWith('quotes/') && !key.startsWith('invoices/') && !key.startsWith('receipts/')) return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } });
    const buf = await storage.get(key).catch(() => null);
    if (!buf) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No such object' } });
    const isHtml = buf.subarray(0, 15).toString().toLowerCase().startsWith('<!doctype html');
    return reply.header('content-type', isHtml ? 'text/html' : key.endsWith('.pdf') ? 'application/pdf' : key.endsWith('.webm') ? 'audio/webm' : 'application/octet-stream').send(buf);
  });

  await app.register(async (api) => {
    await api.register(authRoutes); await api.register(userRoutes); await api.register(leadRoutes); await api.register(meetingRoutes);
    await api.register(quoteRoutes); await api.register(financeRoutes); await api.register(designRoutes); await api.register(approvalRoutes);
    await api.register(adminRoutes); await api.register(publicRoutes); await api.register(webhookRoutes);
  }, { prefix: '/api/v1' });
  return app;
}
export { sessions };
