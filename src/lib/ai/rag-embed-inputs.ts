import { embeddingQueryText } from '@/lib/ai/rag-query-expand';
import type { RagLlmRewrite } from '@/lib/ai/rag-llm-query-rewrite';
import { shouldRunMultiVectorSearch } from '@/lib/ai/rag-query-heuristics';

export function buildEmbedInputs(
  userQuery: string,
  rewrite: RagLlmRewrite | null
): string[] {
  const embedInputs: string[] = [embeddingQueryText(userQuery)];
  if (rewrite && shouldRunMultiVectorSearch(rewrite)) {
    const maxAlt = Math.min(rewrite.searchQueries.length, 3);
    for (let i = 0; i < maxAlt; i++) {
      const sq = rewrite.searchQueries[i]!;
      if (sq.trim().toLowerCase() === userQuery.trim().toLowerCase()) continue;
      embedInputs.push(embeddingQueryText(sq));
    }
  }
  if (rewrite?.speakerHints.some((h) => /rhys/i.test(h))) {
    embedInputs.push(
      embeddingQueryText(
        'Expert Session with Rhys from Kaha Digital website traffic phone calls'
      )
    );
  }
  return [...new Set(embedInputs)];
}

/** Embedding strings added only after LLM rewrite (not in heuristic-only pass). */
export function extraEmbedInputsAfterRewrite(
  userQuery: string,
  before: RagLlmRewrite | null,
  after: RagLlmRewrite | null
): string[] {
  const had = new Set(
    buildEmbedInputs(userQuery, before).map((s) => s.toLowerCase())
  );
  const out: string[] = [];
  for (const input of buildEmbedInputs(userQuery, after)) {
    if (!had.has(input.toLowerCase())) out.push(input);
  }
  return out;
}
