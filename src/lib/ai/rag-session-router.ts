import type { RagQueryIntent } from '@/lib/ai/rag-query-mode';
import type { MatchRow } from '@/lib/ai/rag-merge';
import type { PhraseChunkRow } from '@/lib/ai/rag-phrase-search';
import {
  getTopicById,
  scoreTopicsForQuery,
  type RagTopicDef,
} from '@/lib/ai/rag-topic-catalog';

export type SessionRoute = {
  topicId: string;
  label: string;
  confidence: number;
  topic: RagTopicDef;
};

function parseEnvFloat(value: string | undefined, fallback: number): number {
  const n = parseFloat(value ?? String(fallback));
  return Number.isFinite(n) ? n : fallback;
}

const ROUTE_MIN_CONFIDENCE = parseEnvFloat(
  process.env.RAG_ROUTE_MIN_CONFIDENCE,
  0.48
);
const ROUTE_LOCK_PRIMARY = parseEnvFloat(
  process.env.RAG_ROUTE_LOCK_PRIMARY,
  0.58
);
const ROUTE_RERANK_ONLY = parseEnvFloat(
  process.env.RAG_ROUTE_RERANK_ONLY,
  0.62
);
const SKIP_RERANK_CONFIDENCE = parseEnvFloat(
  process.env.RAG_SKIP_RERANK_CONFIDENCE,
  0.85
);

export function routeQueryToSession(userQuery: string): SessionRoute | null {
  const ranked = scoreTopicsForQuery(userQuery);
  if (ranked.length === 0) return null;

  const top = ranked[0]!;
  const second = ranked[1]?.score ?? 0;
  const margin = top.score - second;
  let confidence = Math.min(1, top.score + margin * 0.35);

  const topic = getTopicById(top.id);
  if (!topic) return null;

  for (const re of topic.blockTitlePatterns ?? []) {
    if (re.test(userQuery)) confidence *= 0.55;
  }

  if (confidence < ROUTE_MIN_CONFIDENCE) return null;

  return {
    topicId: topic.id,
    label: topic.label,
    confidence,
    topic,
  };
}

export function rowMatchesTopic(
  title: string,
  metadata: Record<string, unknown> | null,
  topic: RagTopicDef
): boolean {
  const ragTopics = metadata?.rag_topics;
  if (Array.isArray(ragTopics) && ragTopics.includes(topic.id)) {
    return true;
  }

  const t = title.toLowerCase();
  if (topic.titlePatterns.some((re) => re.test(t))) return true;

  const sourceFile =
    metadata && typeof metadata.source_file === 'string'
      ? metadata.source_file.toLowerCase()
      : '';
  if (
    sourceFile &&
    topic.sourceFilePatterns?.some((re) => re.test(sourceFile))
  ) {
    return true;
  }

  const storagePath =
    metadata && typeof metadata.storage_path === 'string'
      ? metadata.storage_path.toLowerCase()
      : '';
  if (storagePath) {
    if (topic.titlePatterns.some((re) => re.test(storagePath))) return true;
    if (topic.sourceFilePatterns?.some((re) => re.test(storagePath))) {
      return true;
    }
  }

  return false;
}

export function rowBlockedForTopic(title: string, topic: RagTopicDef): boolean {
  const t = title.toLowerCase();
  return (topic.blockTitlePatterns ?? []).some((re) => re.test(t));
}

function titleMatchesPatterns(title: string, patterns: RegExp[]): boolean {
  const t = title.toLowerCase();
  return patterns.some((re) => re.test(t));
}

/** Document keys in merged retrieval that match the routed topic. */
export function docKeysForRoute(
  route: SessionRoute,
  rows: Array<{
    row: MatchRow | PhraseChunkRow;
    rowDocKey: (row: MatchRow) => string;
    rowTitle: (row: MatchRow) => string;
  }>
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const preferred =
    route.topic.primaryTitlePatterns ?? route.topic.titlePatterns;

  const collect = (requirePreferred: boolean) => {
    for (const { row, rowDocKey, rowTitle } of rows) {
      const m = row as MatchRow;
      const title = rowTitle(m);
      if (rowBlockedForTopic(title, route.topic)) continue;
      if (!rowMatchesTopic(title, m.metadata ?? null, route.topic)) continue;
      const isPreferred = titleMatchesPatterns(title, preferred);
      if (requirePreferred && !isPreferred) continue;
      if (!requirePreferred && isPreferred) continue;
      const key = rowDocKey(m);
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  };

  collect(true);
  collect(false);
  return keys;
}

export function shouldLockPrimaryToRoute(route: SessionRoute | null): boolean {
  return route != null && route.confidence >= ROUTE_LOCK_PRIMARY;
}

export function shouldRerankWithinRouteOnly(route: SessionRoute | null): boolean {
  return route != null && route.confidence >= ROUTE_RERANK_ONLY;
}

/** High-confidence topic route: skip Cohere rerank (session scoring already narrowed docs). */
export function shouldSkipRerank(
  route: SessionRoute | null,
  intent?: RagQueryIntent
): boolean {
  if ((process.env.RAG_SKIP_RERANK ?? 'true').toLowerCase() === 'false') {
    return false;
  }
  if (intent === 'comparison') return false;
  return route != null && route.confidence >= SKIP_RERANK_CONFIDENCE;
}

export { ROUTE_LOCK_PRIMARY, ROUTE_RERANK_ONLY, SKIP_RERANK_CONFIDENCE };
