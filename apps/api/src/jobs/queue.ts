import { config } from '../config.js';

export type JobName =
  | 'send_message' | 'mock_delivery' | 'bot_recording_ready' | 'ai_pipeline' | 'embed_document' | 'reminder' | 'followup_reminder'
  | 'evaluate_delays' | 'no_show_check' | 'report_schedules' | 'quiet_hours_release';
type Handler = (payload: any) => Promise<void>;
const handlers = new Map<JobName, Handler>();
export function registerJob(name: JobName, h: Handler) { handlers.set(name, h); }

let bull: { queue: any; worker: any } | null = null;
const timers = new Set<NodeJS.Timeout>();

export async function enqueue(name: JobName, payload: Record<string, unknown>, delayMs = 0) {
  const mode = config.queueMode;
  if (mode === 'inline') {
    // Delayed jobs in inline mode are skipped (mock delivery timers etc.) unless delay is 0
    if (delayMs > 0) return;
    const h = handlers.get(name); if (h) await h(payload); return;
  }
  if (mode === 'bullmq' && config.redisUrl) {
    if (!bull) await initBull();
    await bull!.queue.add(name, payload, { delay: delayMs, removeOnComplete: 100, removeOnFail: 100 });
    return;
  }
  const t = setTimeout(async () => {
    timers.delete(t);
    try { await handlers.get(name)?.(payload); } catch (e) { console.error(`[job ${name}]`, e); }
  }, delayMs);
  t.unref?.();
  timers.add(t);
}

async function initBull() {
  const { Queue, Worker } = await import('bullmq');
  const connection = { url: config.redisUrl! } as any;
  const queue = new Queue('app', { connection });
  const worker = new Worker('app', async (job) => { await handlers.get(job.name as JobName)?.(job.data); }, { connection });
  bull = { queue, worker };
}

/** Periodic jobs (delays every 15 min, no-show every 5 min, reports hourly). */
export function startSchedulers() {
  if (config.queueMode === 'inline') return;
  const every = (ms: number, name: JobName) => { const t = setInterval(() => enqueue(name, {}), ms); t.unref?.(); timers.add(t as any); };
  every(15 * 60 * 1000, 'evaluate_delays');
  every(5 * 60 * 1000, 'no_show_check');
  every(60 * 60 * 1000, 'report_schedules');
  every(5 * 60 * 1000, 'quiet_hours_release');
  every(60 * 1000, 'followup_reminder');
}
export async function stopQueue() { for (const t of timers) clearTimeout(t); timers.clear(); await bull?.worker?.close(); await bull?.queue?.close(); }
