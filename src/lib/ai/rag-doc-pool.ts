/**
 * Steps 7–8 — buildDocPool + filterToDocPool.
 * Shortlist top documents before chunk rerank.
 */

import type { MatchRow } from '@/lib/ai/rag-merge';
import type { PhraseChunkRow } from '@/lib/ai/rag-phrase-search';
import type { RagIntentRoute } from '@/lib/ai/rag-intent-router';
import { dominantVectorDocKey } from '@/lib/ai/rag-multi-vector';
import {
  rowBlockedForTopic,
  rowMatchesTopic,
} from '@/lib/ai/rag-session-router';
import type { SessionRoute } from '@/lib/ai/rag-session-router';
import { getTopicById } from '@/lib/ai/rag-topic-catalog';
import { isSessionCardRow } from '@/lib/ai/session-card';
import { filterMatchesToSessions } from '@/lib/ai/rag-session-select';

export type DocPoolResult = {
  allowedDocKeys: Set<string>;
  scores: Map<string, number>;
  source: 'intent' | 'route' | 'vector' | 'mixed' | 'fallback';
};

function parsePoolSize(): number {
  const raw = parseInt(process.env.RAG_DOC_POOL_SIZE ?? '5', 10);
  if (!Number.isFinite(raw) || raw < 2) return 5;
  return Math.min(raw, 8);
}

export function docPoolEnabled(): boolean {
  return (process.env.RAG_DOC_POOL ?? 'true').toLowerCase() !== 'false';
}

function collectDocMeta(
  matches: MatchRow[],
  titleKeywordRows: PhraseChunkRow[],
  rowDocKey: (row: MatchRow) => string,
  rowTitle: (row: MatchRow) => string
): Map<
  string,
  { title: string; metadata: Record<string, unknown> | null }
> {
  const out = new Map<
    string,
    { title: string; metadata: Record<string, unknown> | null }
  >();
  for (const row of [...matches, ...(titleKeywordRows as MatchRow[])]) {
    const key = rowDocKey(row);
    if (!out.has(key)) {
      out.set(key, {
        title: rowTitle(row),
        metadata: row.metadata ?? null,
      });
    }
  }
  return out;
}

/** Step 7 — score documents and keep top N keys. */
export function buildDocPool(opts: {
  matches: MatchRow[];
  vectorMatches: MatchRow[];
  titleKeywordRows: PhraseChunkRow[];
  intentRoute: RagIntentRoute | null;
  sessionRoute: SessionRoute | null;
  routedDocKeys: string[];
  sessionAgreementDocs: string[];
  rowDocKey: (row: MatchRow) => string;
  rowTitle: (row: MatchRow) => string;
}): DocPoolResult {
  const scores = new Map<string, number>();
  const add = (key: string, delta: number) => {
    if (!key) return;
    scores.set(key, (scores.get(key) ?? 0) + delta);
  };

  const docs = collectDocMeta(
    opts.matches,
    opts.titleKeywordRows,
    opts.rowDocKey,
    opts.rowTitle
  );

  for (const row of opts.matches) {
    const key = opts.rowDocKey(row);
    let sim = typeof row.similarity === 'number' ? row.similarity : 0;
    if (isSessionCardRow(row.metadata)) sim += 0.35;
    add(key, sim * 0.4);
  }

  const vectorConsensus = dominantVectorDocKey(
    opts.vectorMatches,
    opts.rowDocKey,
    10,
    3
  );
  if (vectorConsensus) add(vectorConsensus, 0.42);

  for (const key of opts.sessionAgreementDocs) add(key, 0.28);

  for (const key of opts.routedDocKeys) add(key, 0.55);

  const intentIds = opts.intentRoute?.intents ?? [];
  let intentHits = 0;
  const activeTopics = [
    ...intentIds.map((id) => getTopicById(id)).filter(Boolean),
    ...(opts.sessionRoute ? [opts.sessionRoute.topic] : []),
  ];

  for (const [key, doc] of docs) {
    for (const topic of activeTopics) {
      if (!topic) continue;
      if (rowBlockedForTopic(doc.title, topic)) {
        add(key, -0.5);
        continue;
      }
    }
    for (const intentId of intentIds) {
      const topic = getTopicById(intentId);
      if (!topic) continue;
      if (rowMatchesTopic(doc.title, doc.metadata, topic)) {
        add(key, 0.48);
        intentHits++;
      }
      const ragTopics = doc.metadata?.rag_topics;
      if (Array.isArray(ragTopics) && ragTopics.includes(intentId)) {
        add(key, 0.38);
        intentHits++;
      }
      const coachingIntents = doc.metadata?.coaching_intents;
      if (Array.isArray(coachingIntents) && coachingIntents.includes(intentId)) {
        add(key, 0.4);
        intentHits++;
      }
    }
  }

  if (opts.sessionRoute) {
    for (const [key, doc] of docs) {
      if (rowMatchesTopic(doc.title, doc.metadata, opts.sessionRoute.topic)) {
        add(key, 0.4);
      }
    }
  }

  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const poolSize = parsePoolSize();
  const allowed = new Set<string>();

  const routeMin = parseFloat(process.env.RAG_ROUTE_POOL_ONLY_MIN_CONFIDENCE ?? '0.62');
  const routePoolOnly =
    opts.sessionRoute != null &&
    opts.sessionRoute.confidence >= routeMin &&
    opts.routedDocKeys.length > 0;

  for (const key of opts.routedDocKeys) {
    if (allowed.size >= poolSize) break;
    allowed.add(key);
  }

  if (!routePoolOnly) {
    for (const [key] of sorted) {
      if (allowed.size >= poolSize) break;
      allowed.add(key);
    }
  }

  if (allowed.size === 0 && sorted[0]) {
    allowed.add(sorted[0][0]);
  }

  let source: DocPoolResult['source'] = 'mixed';
  if (intentHits > 0 && opts.routedDocKeys.length > 0) source = 'intent';
  else if (intentHits > 0) source = 'intent';
  else if (opts.routedDocKeys.length > 0) source = 'route';
  else if (vectorConsensus) source = 'vector';
  else if (allowed.size === 0) source = 'fallback';

  return { allowedDocKeys: allowed, scores, source };
}

/** Step 8 — restrict merged candidates to doc pool (no-op if pool empty). */
export function filterToDocPool(
  matches: MatchRow[],
  pool: DocPoolResult,
  rowDocKey: (row: MatchRow) => string
): MatchRow[] {
  if (!docPoolEnabled() || pool.allowedDocKeys.size === 0) {
    return matches;
  }
  const filtered = filterMatchesToSessions(
    matches,
    pool.allowedDocKeys,
    rowDocKey
  );
  return filtered.length > 0 ? filtered : matches;
}
