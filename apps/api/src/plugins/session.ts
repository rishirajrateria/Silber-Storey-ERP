import type { Redis } from 'ioredis';
import { config } from '../config.js';
import { newToken } from '../lib/tokens.js';

export interface SessionData { sid: string; userId: string; deviceId: string; ip: string; ua: string; createdAt: string; lastSeenAt: string }
interface Store { get(sid: string): Promise<SessionData | null>; set(s: SessionData): Promise<void>; del(sid: string): Promise<void>; listByUser(userId: string): Promise<SessionData[]> }

const memory = new Map<string, SessionData>();
const memStore: Store = {
  async get(sid) { return memory.get(sid) ?? null; },
  async set(s) { memory.set(s.sid, s); },
  async del(sid) { memory.delete(sid); },
  async listByUser(userId) { return [...memory.values()].filter((s) => s.userId === userId); },
};

let redis: Redis | null = null;
const TTL = 60 * 60 * 24 * 14;
const redisStore: Store = {
  async get(sid) { const v = await redis!.get(`sess:${sid}`); return v ? JSON.parse(v) : null; },
  async set(s) { await redis!.set(`sess:${s.sid}`, JSON.stringify(s), 'EX', TTL); await redis!.sadd(`usess:${s.userId}`, s.sid); },
  async del(sid) { const s = await this.get(sid); await redis!.del(`sess:${sid}`); if (s) await redis!.srem(`usess:${s.userId}`, sid); },
  async listByUser(userId) { const ids = await redis!.smembers(`usess:${userId}`); const out: SessionData[] = []; for (const id of ids) { const s = await this.get(id); if (s) out.push(s); } return out; },
};

let store: Store = memStore;
export async function initSessionStore() {
  if (config.redisUrl && !config.isTest) {
    try {
      const mod: any = await import('ioredis');
      const IORedis = mod.default ?? mod.Redis ?? mod;
      const r: Redis = new IORedis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
      await r.connect(); redis = r; store = redisStore;
    } catch (e) { console.warn('Redis unavailable, using in-memory sessions'); redis = null; store = memStore; }
  }
}
export const sessions = {
  async create(userId: string, ip: string, ua: string) {
    const now = new Date().toISOString();
    const s: SessionData = { sid: newToken(), userId, deviceId: newToken().slice(0, 16), ip, ua, createdAt: now, lastSeenAt: now };
    await store.set(s); return s;
  },
  get: (sid: string) => store.get(sid),
  touch: async (s: SessionData) => { s.lastSeenAt = new Date().toISOString(); await store.set(s); },
  destroy: (sid: string) => store.del(sid),
  listByUser: (userId: string) => store.listByUser(userId),
  async destroyAllForUser(userId: string) { for (const s of await store.listByUser(userId)) await store.del(s.sid); },
};
export const COOKIE = 'sid';
