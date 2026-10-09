'use client';
import { openDB, type IDBPDatabase } from 'idb';
import { api } from './api';
import { useStore } from './store';

interface QueuedReq { id?: number; method: string; path: string; json?: unknown; at: number; kind: string }
let dbp: Promise<IDBPDatabase> | null = null;
const db = () => (dbp ??= openDB('leadapp', 1, { upgrade(d) { d.createObjectStore('queue', { keyPath: 'id', autoIncrement: true }); d.createObjectStore('chunks', { keyPath: 'key' }); d.createObjectStore('cache', { keyPath: 'key' }); } }));

/** Section 6.4: offline queue for notes, log-contact, status changes, check-in. Replayed in order on reconnect. */
export async function queueOrSend(kind: string, method: string, path: string, json?: unknown) {
  if (navigator.onLine) { try { return await api(path, { method, json }); } catch (e: any) { if (e?.status) throw e; } }
  const d = await db(); await d.add('queue', { kind, method, path, json, at: Date.now() } satisfies QueuedReq);
  await refreshCount();
  return { queued: true };
}
export async function refreshCount() { const d = await db(); useStore.getState().setQueued(await d.count('queue')); }
export async function replayQueue() {
  const d = await db(); const all = (await d.getAll('queue')) as QueuedReq[];
  for (const q of all.sort((a, b) => a.at - b.at)) {
    try { await api(q.path, { method: q.method, json: q.json }); await d.delete('queue', q.id!); }
    catch (e: any) { if (e?.status === 409 && e.code === 'STALE') { useStore.getState().notify(`Conflict replaying ${q.kind}; dropped`, 'err'); await d.delete('queue', q.id!); } else if (e?.status) { await d.delete('queue', q.id!); useStore.getState().notify(`${q.kind} failed: ${e.message}`, 'err'); } else break; }
  }
  await refreshCount();
}
export async function cachePut(key: string, value: unknown) { const d = await db(); await d.put('cache', { key, value, at: Date.now() }); }
export async function cacheGet<T = any>(key: string): Promise<T | null> { const d = await db(); return ((await d.get('cache', key))?.value as T) ?? null; }
export async function chunkPut(key: string, blob: Blob) { const d = await db(); await d.put('chunks', { key, blob }); }
export async function chunkList(prefix: string) { const d = await db(); return ((await d.getAll('chunks')) as Array<{ key: string; blob: Blob }>).filter((c) => c.key.startsWith(prefix)).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })); }
export async function chunkClear(prefix: string) { const d = await db(); for (const c of await chunkList(prefix)) await d.delete('chunks', c.key); }
