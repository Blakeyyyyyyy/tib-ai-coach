import { embeddingQueryText } from '@/lib/ai/rag-query-expand';
import type { RagLlmRewrite } from '@/lib/ai/rag-llm-query-rewrite';
import {
  classifyRetrievalMode,
  type RetrievalMode,
} from '@/lib/ai/rag-retrieval-mode';

/** Short keyword phrases safe for parallel vector embed (not full-sentence rewrites). */
export function keywordEmbedsFromRewrite(
  rewrite: RagLlmRewrite | null
): string[] {
  if (!rewrite) return [];
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.replace(/\s+/g, ' ').trim();
    if (t.length < 3) return;
    const words = t.split(/\s+/).length;
    if (words > 8) return;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  for (const k of rewrite.keywordExpansions) add(k);
  for (const p of rewrite.topicPhrases) add(p);
  for (const s of rewrite.searchQueries) {
    if (s.split(/\s+/).length <= 6) add(s);
  }
  return out.slice(0, 6);
}

export function buildEmbedInputs(
  userQuery: string,
  rewrite: RagLlmRewrite | null,
  mode?: RetrievalMode
): string[] {
  const retrievalMode = mode ?? classifyRetrievalMode(userQuery);
  const embedInputs: string[] = [embeddingQueryText(userQuery)];

  if (retrievalMode === 'explicit_session') {
    return embedInputs;
  }

  if (retrievalMode === 'vague' && rewrite) {
    for (const kw of keywordEmbedsFromRewrite(rewrite)) {
      embedInputs.push(kw);
    }
  }

  if (retrievalMode === 'specific' && rewrite) {
    for (const kw of keywordEmbedsFromRewrite(rewrite).slice(0, 2)) {
      embedInputs.push(kw);
    }
  }

  if (rewrite?.speakerHints.some((h) => /rhys/i.test(h))) {
    embedInputs.push('Rhys Kaha Digital website marketing');
  }

  return [...new Set(embedInputs)];
}

/** Embedding strings added only after LLM keyword expansion (not in heuristic-only pass). */
export function extraEmbedInputsAfterRewrite(
  userQuery: string,
  before: RagLlmRewrite | null,
  after: RagLlmRewrite | null,
  mode?: RetrievalMode
): string[] {
  const had = new Set(
    buildEmbedInputs(userQuery, before, mode).map((s) => s.toLowerCase())
  );
  const out: string[] = [];
  for (const input of buildEmbedInputs(userQuery, after, mode)) {
    if (!had.has(input.toLowerCase())) out.push(input);
  }
  return out;
}

export function shouldRunMultiVectorSearch(
  userQuery: string,
  rewrite: RagLlmRewrite | null,
  mode?: RetrievalMode
): boolean {
  const retrievalMode = mode ?? classifyRetrievalMode(userQuery);
  if (retrievalMode === 'explicit_session') return false;
  return buildEmbedInputs(userQuery, rewrite, retrievalMode).length > 1;
}
