import { prisma } from '../lib/db.js';
import { ai } from '../integrations/index.js';
import { searchDocuments } from './rag.js';
import { writeAudit } from '../lib/audit.js';
import { report, stats } from './reports.js';
import { roadmap } from './leads.js';

const SYSTEM = `You are the Admin assistant for an interior-design lead management app. Answer conversationally in English. Always cite sources as {docType, leadId, clientName, meetingDate, versionNo, quotedLine}. If the answer is not found in the documents or tools, say so. Never guess commitments made to clients.`;

export const tools = {
  search_documents: async ({ query, filters }: { query: string; filters?: any }) => searchDocuments(query, filters ?? {}),
  get_lead: async ({ id }: { id: string }) => prisma.lead.findUnique({ where: { id }, include: { client: true, salesStatus: true, engineerStatus: true } }),
  list_leads: async ({ filters }: { filters?: any }) => prisma.lead.findMany({ where: filters ?? {}, take: 50, include: { client: true } }),
  funnel_stats: async ({ from, to }: { from?: string; to?: string }) => ({ by_status: await report('leads_by_status', { from, to }), qualification: await report('qualification_rate', { from, to }) }),
  pending_approvals: async () => prisma.approval.findMany({ where: { status: 'pending' } }),
  delays: async () => prisma.delay.findMany({ where: { resolvedAt: null } }),
  user_locations: async () => prisma.user.findMany({ where: { lastLat: { not: null } }, select: { id: true, name: true, lastLat: true, lastLng: true, lastLocAt: true } }),
  lead_roadmap: async ({ id }: { id: string }) => roadmap(id),
  invoice_status: async ({ leadId }: { leadId: string }) => prisma.invoice.findMany({ where: { leadId }, include: { payments: true } }),
  global_stats: async () => stats('global'),
};

const sessionsMem = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>();

export async function* chat(userId: string, sessionId: string, message: string) {
  const history = sessionsMem.get(sessionId) ?? [];
  history.push({ role: 'user', content: message });
  const messages = [{ role: 'system' as const, content: SYSTEM }, ...history.slice(-10)];
  let answer = ''; let citations: unknown[] = [];
  for await (const ev of ai.chat(messages, tools, {})) {
    if (ev.delta) { answer += ev.delta; yield { type: 'delta', delta: ev.delta }; }
    if (ev.citations) { citations = ev.citations; yield { type: 'citations', citations }; }
  }
  history.push({ role: 'assistant', content: answer });
  sessionsMem.set(sessionId, history);
  await writeAudit({ actorUserId: userId, actorRole: 'admin', action: 'ai_chat', entityType: 'AiSession', entityId: sessionId, before: { question: message }, after: { answer, citations } });
  yield { type: 'done' };
}
