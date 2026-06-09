import type { RagLlmRewrite } from '@/lib/ai/rag-llm-query-rewrite';
import type { MatchRow } from '@/lib/ai/rag-merge';
import type { PhraseChunkRow } from '@/lib/ai/rag-phrase-search';
import {
  intentKeywordsForRewrite,
  type RagIntentRoute,
} from '@/lib/ai/rag-intent-router';
import {
  buildTopicHeuristicRewrite,
  topicForceDocKeys,
} from '@/lib/ai/rag-topic-engine';
import type { SessionRoute } from '@/lib/ai/rag-session-router';

/** Deterministic retrieval hints — delegated to topic catalog engine. */
export function buildHeuristicRagRewrite(userQuery: string): RagLlmRewrite {
  return buildTopicHeuristicRewrite(userQuery);
}

export function mergeRagRewrites(
  userQuery: string,
  llm: RagLlmRewrite | null,
  intentRoute?: RagIntentRoute | null
): RagLlmRewrite | null {
  const h = buildTopicHeuristicRewrite(userQuery);
  const intentKw = intentKeywordsForRewrite(intentRoute ?? null);
  const hopefulHeuristic =
    h.topicPhrases.some((p) => /most hopeful/i.test(p)) ||
    h.searchQueries.some((s) => /drunk accountants/i.test(s));

  let llmQueries = llm?.searchQueries ?? [];
  if (hopefulHeuristic) {
    llmQueries = llmQueries.filter((s) => !/\beofy\b/i.test(s));
  }

  const merged: RagLlmRewrite = {
    keywordExpansions: [
      ...new Set([
        ...h.keywordExpansions,
        ...intentKw.keywordExpansions,
        ...(llm?.keywordExpansions ?? []),
      ]),
    ].slice(0, 6),
    searchQueries: [...new Set([...h.searchQueries, ...llmQueries])].slice(0, 3),
    speakerHints: [...new Set([...h.speakerHints, ...(llm?.speakerHints ?? [])])],
    topicPhrases: [
      ...new Set([
        ...h.topicPhrases,
        ...intentKw.topicPhrases,
        ...(llm?.topicPhrases ?? []),
      ]),
    ].slice(0, 10),
  };

  const hasSignal =
    merged.keywordExpansions.length > 0 ||
    merged.searchQueries.length > 0 ||
    merged.topicPhrases.length > 0 ||
    merged.speakerHints.length > 0;

  return hasSignal ? merged : llm;
}

/** Force-include doc keys for active topics — delegated to topic engine. */
export function queryHintsForceDocKeys(
  userQuery: string,
  scanMatches: MatchRow[],
  titleKeywordRows: PhraseChunkRow[],
  rowDocKey: (row: MatchRow) => string,
  rowTitle: (row: MatchRow) => string,
  sessionRoute?: SessionRoute | null
): string[] {
  return topicForceDocKeys(
    userQuery,
    sessionRoute ?? null,
    scanMatches,
    titleKeywordRows,
    rowDocKey,
    rowTitle
  );
}
