/**
 * Semantic reranking via Cohere Rerank API (v2).
 */

import type { RerankOutcome, RerankPassage } from '@/lib/ai/rerank-types';

const DEFAULT_MODEL = 'rerank-v3.5';
const COHERE_RERANK_URL = 'https://api.cohere.com/v2/rerank';

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function passageDocument(p: RerankPassage): string {
  const sim =
    p.similarity > 0 ? ` (vector=${p.similarity.toFixed(2)})` : '';
  const title = truncate(p.title, 160);
  const body = truncate(p.text.replace(/\s+/g, ' ').trim(), 3500);
  return `Document: "${title}"${sim}\n${body}`;
}

type CohereRerankResponse = {
  results?: Array<{
    index?: number;
    relevance_score?: number;
  }>;
};

export async function rerankPassagesWithCohere(
  query: string,
  passages: RerankPassage[],
  apiKey: string,
  options?: {
    model?: string;
    topN?: number;
    minScore?: number;
  }
): Promise<RerankOutcome> {
  if (passages.length === 0) return { order: [], drop: [] };
  if (passages.length === 1) return { order: [passages[0].index], drop: [] };

  const model =
    options?.model ?? process.env.COHERE_RERANK_MODEL ?? DEFAULT_MODEL;
  const topNRaw =
    options?.topN ??
    parseInt(process.env.RAG_COHERE_RERANK_TOP_N ?? String(passages.length), 10);
  const topN =
    Number.isFinite(topNRaw) && topNRaw >= 1 ? topNRaw : passages.length;
  const minScore =
    options?.minScore ??
    parseFloat(process.env.RAG_COHERE_RERANK_MIN_SCORE ?? '0.05');

  const documents = passages.map(passageDocument);

  const res = await fetch(COHERE_RERANK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      query: truncate(query, 2000),
      documents,
      top_n: Math.min(Math.max(1, topN), documents.length),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cohere rerank failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as CohereRerankResponse;
  const results = data.results ?? [];

  const order: number[] = [];
  const dropSet = new Set<number>();
  const seen = new Set<number>();

  for (const hit of results) {
    const idx = hit.index;
    const score = hit.relevance_score ?? 0;
    if (typeof idx !== 'number' || !Number.isFinite(idx)) continue;
    const passage = passages[idx];
    if (!passage || seen.has(passage.index)) continue;

    if (score < minScore) {
      dropSet.add(passage.index);
      continue;
    }

    seen.add(passage.index);
    order.push(passage.index);
  }

  for (const p of passages) {
    if (!seen.has(p.index) && !dropSet.has(p.index)) {
      dropSet.add(p.index);
    }
  }

  if (order.length === 0) {
    return {
      order: passages.map((p) => p.index),
      drop: [],
    };
  }

  return { order, drop: [...dropSet] };
}
