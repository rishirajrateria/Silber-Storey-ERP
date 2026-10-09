import { prisma } from '../lib/db.js';
import { ai } from '../integrations/index.js';

/** Chunk ~800 tokens (≈3200 chars) with 100-token (≈400 chars) overlap. */
export function chunkText(text: string, size = 3200, overlap = 400) {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size - overlap) { out.push(text.slice(i, i + size)); if (i + size >= text.length) break; }
  return out.length ? out : [''];
}

export async function embedDocument(p: { docType: string; docId: string; leadId?: string | null; clientId?: string | null; text: string; meta?: Record<string, unknown> }) {
  await prisma.documentChunk.deleteMany({ where: { docType: p.docType, docId: p.docId } });
  const chunks = chunkText(p.text);
  const vectors = await ai.embed(chunks);
  await prisma.documentChunk.createMany({ data: chunks.map((text, i) => ({ docType: p.docType, docId: p.docId, leadId: p.leadId ?? null, clientId: p.clientId ?? null, chunkIndex: i, text, embedding: vectors[i] ?? [], meta: (p.meta ?? {}) as any })) });
}

const cosine = (a: number[], b: number[]) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return na && nb ? d / Math.sqrt(na * nb) : 0; };

/** In-app cosine search over DocumentChunk (pgvector `<=>` when available in prod; see DECISIONS.md). */
export async function searchDocuments(query: string, filters: { clientId?: string; leadId?: string; docType?: string; from?: string; to?: string } = {}, limit = 8) {
  const [qv] = await ai.embed([query]);
  const where: any = {};
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.leadId) where.leadId = filters.leadId;
  if (filters.docType) where.docType = filters.docType;
  const chunks = await prisma.documentChunk.findMany({ where, take: 2000 });
  const q = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const scored = chunks.map((c) => ({ c, score: cosine(qv, c.embedding) + q.filter((w) => c.text.toLowerCase().includes(w)).length * 0.05 })).sort((a, b) => b.score - a.score).slice(0, limit);
  const leadIds = [...new Set(scored.map((s) => s.c.leadId).filter(Boolean))] as string[];
  const leads = await prisma.lead.findMany({ where: { id: { in: leadIds } }, include: { client: true } });
  return scored.map(({ c, score }) => { const l = leads.find((x) => x.id === c.leadId); const meta = (c.meta ?? {}) as any; return { docType: c.docType, docId: c.docId, leadId: c.leadId, clientName: l?.client.name ?? null, meetingDate: meta.meetingDate ?? null, versionNo: meta.versionNo ?? null, text: c.text, score }; });
}
