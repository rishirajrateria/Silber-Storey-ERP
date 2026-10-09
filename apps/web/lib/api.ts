export class ApiError extends Error { constructor(public status: number, public code: string, message: string, public details?: any) { super(message); } }
const BASE = '/api/v1';

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`${BASE}${path}`, { credentials: 'include', ...rest, headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(rest.headers ?? {}) }, body: json !== undefined ? JSON.stringify(json) : rest.body });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) { const e = (body as any)?.error ?? {}; throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? res.statusText, e.details); }
  return body as T;
}
export const get = <T = any>(p: string) => api<{ data: T; meta?: any }>(p);
export const post = <T = any>(p: string, json?: unknown) => api<{ data: T }>(p, { method: 'POST', json: json ?? {} });
export const put = <T = any>(p: string, json?: unknown) => api<{ data: T }>(p, { method: 'PUT', json });
export const patch = <T = any>(p: string, json?: unknown) => api<{ data: T }>(p, { method: 'PATCH', json });
export const del = <T = any>(p: string, json?: unknown) => api<{ data: T }>(p, { method: 'DELETE', json });
export const fileUrl = (p: string) => `${BASE}${p}`;
