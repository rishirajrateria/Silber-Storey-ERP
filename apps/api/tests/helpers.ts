import { execSync } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';

let app: FastifyInstance;
let prepared = false;
export async function getApp() {
  if (!prepared) {
    execSync('npx prisma migrate deploy', { stdio: 'ignore', env: process.env });
    execSync('npx tsx prisma/seed.ts', { stdio: 'ignore', env: process.env });
    prepared = true;
  }
  if (!app) { app = await buildApp(); await app.ready(); }
  return app;
}
export async function resetData() {
  // keep config tables (users, statuses, settings, templates, rules); wipe transactional data
  await prisma.$executeRawUnsafe('TRUNCATE "Lead", "Client", "Approval", "Message", "Notification", "Delay", "AuditLog", "DocumentChunk", "LocationTrack" CASCADE');
}
const cookies: Record<string, string> = {};
export async function login(role: string) {
  if (cookies[role]) return cookies[role];
  const a = await getApp();
  const r = await a.inject({ method: 'POST', url: '/api/v1/auth/dev-login', payload: { email: `${role === 'design_head' ? 'design' : role === 'junior_designer' ? 'junior' : role}@example.com` } });
  if (r.statusCode !== 200) throw new Error(`login ${role}: ${r.body}`);
  cookies[role] = r.cookies.find((c) => c.name === 'sid')!.value;
  return cookies[role];
}
export const api = (role: string) => ({
  async call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
    const a = await getApp();
    const r = await a.inject({ method, url: `/api/v1${url}`, payload: payload as any, cookies: { sid: await login(role) } });
    let json: any = null; try { json = r.json(); } catch { json = r.body; }
    return { status: r.statusCode, body: json, data: json?.data, error: json?.error, raw: r };
  },
  get(url: string) { return this.call('GET', url); },
  post(url: string, payload?: unknown) { return this.call('POST', url, payload); },
  put(url: string, payload?: unknown) { return this.call('PUT', url, payload); },
  patch(url: string, payload?: unknown) { return this.call('PATCH', url, payload); },
  del(url: string, payload?: unknown) { return this.call('DELETE', url, payload); },
});
export const pub = {
  async call(method: 'GET' | 'POST', url: string, payload?: unknown) { const a = await getApp(); const r = await a.inject({ method, url: `/api/v1${url}`, payload: payload as any }); let json: any; try { json = r.json(); } catch { json = r.body; } return { status: r.statusCode, body: json, data: json?.data, error: json?.error }; },
};
export { prisma };
export const statusId = async (dashboard: 'sales' | 'engineer', key: string) => (await prisma.leadStatus.findUniqueOrThrow({ where: { dashboard_key: { dashboard, key } } })).id;
export const sourceId = async () => (await prisma.leadSource.findFirstOrThrow()).id;
export const userId = async (role: string) => (await prisma.user.findFirstOrThrow({ where: { role: role as any } })).id;
export const iso = (offsetMin: number) => new Date(Date.now() + offsetMin * 60000).toISOString();
