/**
 * RAG reranking via Cohere.
 */

import { rerankPassagesWithCohere } from '@/lib/ai/rerank-cohere';
import type { RerankOutcome, RerankPassage } from '@/lib/ai/rerank-types';

export type { RerankOutcome, RerankPassage };

export async function rerankPassages(
  query: string,
  passages: RerankPassage[],
  cohereKey?: string
): Promise<RerankOutcome> {
  const key = cohereKey ?? process.env.COHERE_API_KEY?.trim();
  if (!key) {
    console.warn('COHERE_API_KEY missing; skipping rerank');
    return {
      order: passages.map((p) => p.index),
      drop: [],
    };
  }
  return rerankPassagesWithCohere(query, passages, key);
}
