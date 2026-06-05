import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchFtsMatches } from '@/lib/ai/rag-fts-search';
import type { PhraseChunkRow } from '@/lib/ai/rag-phrase-search';
import {
  fetchPhraseMatches,
  phraseSearchCandidates,
} from '@/lib/ai/rag-phrase-search';
import { fetchTitleKeywordMatches } from '@/lib/ai/rag-title-keyword-search';
import type { RagLlmRewrite } from '@/lib/ai/rag-llm-query-rewrite';

export function buildLexicalQuery(
  userQuery: string,
  rewrite: RagLlmRewrite | null
): string {
  if (!rewrite) return userQuery;
  return `${userQuery} ${[
    ...rewrite.searchQueries,
    ...rewrite.topicPhrases,
    ...rewrite.speakerHints,
  ].join(' ')}`;
}

export type LexicalFetchResult = {
  titleKeywordRows: PhraseChunkRow[];
  phraseRows: PhraseChunkRow[];
  ftsRows: PhraseChunkRow[];
  ftsHitIds: Set<string>;
  ftsRanks: Map<string, number>;
};

export async function fetchLexicalMatchesParallel(
  admin: SupabaseClient,
  userQuery: string,
  lexicalQuery: string,
  extraPhraseTopics: string[],
  ftsLimit: number
): Promise<LexicalFetchResult> {
  const phraseCandidates = [
    ...new Set([
      ...phraseSearchCandidates(userQuery),
      ...extraPhraseTopics,
    ]),
  ];

  const [titleKeywordRows, phraseRows, fts] = await Promise.all([
    fetchTitleKeywordMatches(admin, lexicalQuery),
    phraseCandidates.length > 0
      ? fetchPhraseMatches(admin, userQuery, 24, extraPhraseTopics)
      : Promise.resolve([] as PhraseChunkRow[]),
    fetchFtsMatches(admin, lexicalQuery, ftsLimit),
  ]);

  return {
    titleKeywordRows,
    phraseRows,
    ftsRows: fts.rows,
    ftsHitIds: fts.ftsChunkIds,
    ftsRanks: fts.ranks,
  };
}

export function mergeTitleKeywordRows(
  base: PhraseChunkRow[],
  extra: PhraseChunkRow[]
): PhraseChunkRow[] {
  if (extra.length === 0) return base;
  const seen = new Set(base.map((r) => r.id));
  const out = [...base];
  for (const row of extra) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

export function mergePhraseRows(
  base: PhraseChunkRow[],
  extra: PhraseChunkRow[]
): PhraseChunkRow[] {
  return mergeTitleKeywordRows(base, extra);
}
