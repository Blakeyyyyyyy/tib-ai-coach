/**
 * Unified topic-driven retrieval: routing, session scoring, heuristics, primary correction.
 * Single mechanism for Rhys/website, Joe Pane, Nic & Waz, Momentum dates, EOFY vs Financial Jam.
 */

import type { RagLlmRewrite } from '@/lib/ai/rag-llm-query-rewrite';
import {
  extractExplicitSessionTitle,
  findDocKeyForExplicitSession,
  sessionTitleMatchScore,
} from '@/lib/ai/rag-explicit-session';
import type { MatchRow } from '@/lib/ai/rag-merge';
import type { PhraseChunkRow } from '@/lib/ai/rag-phrase-search';
import {
  dominantVectorDocKey,
} from '@/lib/ai/rag-multi-vector';
import {
  getTopicById,
  scoreTopicsForQuery,
  type RagTopicDef,
} from '@/lib/ai/rag-topic-catalog';
import {
  rowBlockedForTopic,
  rowMatchesTopic,
  type SessionRoute,
} from '@/lib/ai/rag-session-router';

export const TOPIC_ACTIVE_MIN_SCORE = 0.22;

export type RankedTopic = { id: string; score: number; topic: RagTopicDef };

export function rankedTopicsForQuery(userQuery: string): RankedTopic[] {
  return scoreTopicsForQuery(userQuery)
    .map((r) => {
      const topic = getTopicById(r.id);
      return topic ? { ...r, topic } : null;
    })
    .filter((r): r is RankedTopic => r != null);
}

export function activeTopicsForQuery(
  userQuery: string,
  sessionRoute?: SessionRoute | null
): RagTopicDef[] {
  const seen = new Set<string>();
  const out: RagTopicDef[] = [];

  if (sessionRoute?.topic && !seen.has(sessionRoute.topic.id)) {
    seen.add(sessionRoute.topic.id);
    out.push(sessionRoute.topic);
  }

  for (const r of rankedTopicsForQuery(userQuery)) {
    if (r.score < TOPIC_ACTIVE_MIN_SCORE) continue;
    if (seen.has(r.topic.id)) continue;
    seen.add(r.topic.id);
    out.push(r.topic);
  }

  return out;
}

export function isQueryForTopic(userQuery: string, topicId: string): boolean {
  return rankedTopicsForQuery(userQuery).some(
    (r) => r.id === topicId && r.score >= TOPIC_ACTIVE_MIN_SCORE
  );
}

function collectDocRows(
  matches: MatchRow[],
  titleKeywordRows: PhraseChunkRow[],
  rowDocKey: (row: MatchRow) => string,
  rowTitle: (row: MatchRow) => string
): Array<{ key: string; title: string; metadata: Record<string, unknown> | null }> {
  const out: Array<{
    key: string;
    title: string;
    metadata: Record<string, unknown> | null;
  }> = [];
  const seen = new Set<string>();
  for (const row of [...matches, ...(titleKeywordRows as MatchRow[])]) {
    const key = rowDocKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      title: rowTitle(row),
      metadata: row.metadata ?? null,
    });
  }
  return out;
}

/** Session score boosts/penalties from active topics (replaces per-case penalty modules). */
export function applyTopicSessionScores(
  userQuery: string,
  sessionRoute: SessionRoute | null,
  sessionScores: Map<string, number>,
  matches: MatchRow[],
  titleKeywordRows: PhraseChunkRow[],
  rowDocKey: (row: MatchRow) => string,
  rowTitle: (row: MatchRow) => string
): void {
  const topics = activeTopicsForQuery(userQuery, sessionRoute);
  if (topics.length === 0) return;

  const docs = collectDocRows(matches, titleKeywordRows, rowDocKey, rowTitle);

  for (const topic of topics) {
    const boost = topic.sessionBoost ?? 0.42;
    const preferredBoost = boost + 0.22;
    const penalty = topic.blockPenalty ?? 0.55;

    for (const doc of docs) {
      const preferred =
        topic.primaryTitlePatterns?.some((re) => re.test(doc.title.toLowerCase())) ??
        false;
      if (rowMatchesTopic(doc.title, doc.metadata, topic)) {
        let add = preferred ? preferredBoost : boost;
        if (topic.id.startsWith('pdf_')) {
          const meta = doc.metadata ?? {};
          if (typeof meta.storage_path === 'string' && meta.storage_path.endsWith('.pdf')) {
            add += 0.28;
          } else if (meta.source_type === 'video_transcript') {
            add = Math.max(0, add - 0.35);
          }
        }
        sessionScores.set(doc.key, (sessionScores.get(doc.key) ?? 0) + add);
      }
      if (rowBlockedForTopic(doc.title, topic)) {
        sessionScores.set(
          doc.key,
          Math.max(0, (sessionScores.get(doc.key) ?? 0) - penalty)
        );
      }
    }

    if (topic.id === 'nic_waz_meeting') {
      for (const doc of docs) {
        if (/15 keys for team meetings/i.test(doc.title.toLowerCase())) {
          sessionScores.set(doc.key, (sessionScores.get(doc.key) ?? 0) + 0.12);
        }
      }
    }
  }

  const anchor = extractExplicitSessionTitle(userQuery);
  if (anchor) {
    for (const doc of docs) {
      const score = sessionTitleMatchScore(anchor, doc.title);
      if (score >= 70) {
        sessionScores.set(doc.key, (sessionScores.get(doc.key) ?? 0) + 0.42);
      } else if (score < 35 && /momentum meet/i.test(doc.title.toLowerCase())) {
        sessionScores.set(
          doc.key,
          Math.max(0, (sessionScores.get(doc.key) ?? 0) - 0.35)
        );
      }
    }
  }
}

/** Deterministic rewrite hints from topic catalog (replaces buildHeuristicRagRewrite cases). */
export function buildTopicHeuristicRewrite(userQuery: string): RagLlmRewrite {
  const searchQueries: string[] = [];
  const speakerHints: string[] = [];
  const topicPhrases: string[] = [];
  const q = userQuery.replace(/\s+/g, ' ').trim();

  const add = (arr: string[], ...items: string[]) => {
    for (const item of items) {
      const s = item.trim();
      if (s.length < 3) continue;
      if (!arr.includes(s)) arr.push(s);
    }
  };

  for (const topic of activeTopicsForQuery(q)) {
    add(speakerHints, ...(topic.heuristicSpeakerHints ?? []));
    add(searchQueries, ...(topic.heuristicSearchQueries ?? []));
    add(topicPhrases, ...(topic.heuristicTopicPhrases ?? []));
    if (topic.titleSearchTerms) {
      add(topicPhrases, ...topic.titleSearchTerms);
    }
    if (topic.label && !searchQueries.some((s) => s.includes(topic.label))) {
      add(searchQueries, topic.label);
    }
  }

  if (/\bcompare\b/i.test(q) && /\bget off the tools\b/i.test(q)) {
    add(searchQueries, 'Get Off the Tools delegation Joe Pane');
  }
  if (/\bcompare\b/i.test(q) && /\bjoe pane\b/i.test(q)) {
    add(searchQueries, 'Expert Webinar with Joe Pane Get Off the Tools');
  }

  return { keywordExpansions: [], searchQueries, speakerHints, topicPhrases };
}

/** Force-include doc keys for active topics (replaces queryHintsForceDocKeys). */
export function topicForceDocKeys(
  userQuery: string,
  sessionRoute: SessionRoute | null,
  scanMatches: MatchRow[],
  titleKeywordRows: PhraseChunkRow[],
  rowDocKey: (row: MatchRow) => string,
  rowTitle: (row: MatchRow) => string
): string[] {
  const keys: string[] = [];
  const scan = [
    ...scanMatches.slice(0, 40),
    ...(titleKeywordRows as MatchRow[]).slice(0, 40),
  ];
  const topics = activeTopicsForQuery(userQuery, sessionRoute);

  const pushFirstMatch = (pred: (title: string, meta: Record<string, unknown> | null) => boolean) => {
    for (const row of scan) {
      if (pred(rowTitle(row), row.metadata ?? null)) {
        keys.push(rowDocKey(row));
        return true;
      }
    }
    return false;
  };

  const matchesPreferred = (
    title: string,
    meta: Record<string, unknown> | null,
    topic: RagTopicDef
  ): boolean => {
    const patterns = topic.primaryTitlePatterns ?? topic.titlePatterns;
    const t = title.toLowerCase();
    if (patterns.some((re) => re.test(t))) return true;
    const ragTopics = meta?.rag_topics;
    return Array.isArray(ragTopics) && ragTopics.includes(topic.id);
  };

  for (const topic of topics) {
    const preferred = topic.primaryTitlePatterns;
    if (preferred?.length) {
      const hit = pushFirstMatch((title, meta) => matchesPreferred(title, meta, topic));
      if (hit) continue;
    }
    pushFirstMatch((title, meta) => rowMatchesTopic(title, meta, topic));
  }

  const anchor = extractExplicitSessionTitle(userQuery);
  if (anchor) {
    const forced = findDocKeyForExplicitSession(
      anchor,
      scan,
      rowDocKey,
      rowTitle
    );
    if (forced) keys.unshift(forced);
  }

  return [...new Set(keys)];
}

function titleLooksLikeGenericJulyMomentum(title: string): boolean {
  const t = title.toLowerCase();
  return /momentum meet/i.test(t) && /\bjuly\b/i.test(t);
}

/** Prefer vector consensus when primary is a known collision title for active topics. */
export function applyTopicVectorConsensusPrimary(
  primaryKey: string,
  userQuery: string,
  vectorMatches: MatchRow[],
  diversifiedMatches: MatchRow[],
  rowDocKeyFn: (row: MatchRow) => string,
  rowTitleFn: (row: MatchRow) => string,
  sessionRoute: SessionRoute | null
): string {
  const consensus = dominantVectorDocKey(vectorMatches, rowDocKeyFn, 10, 3);
  if (!consensus || consensus === primaryKey) return primaryKey;

  const consensusRow =
    vectorMatches.find((m) => rowDocKeyFn(m) === consensus) ??
    diversifiedMatches.find((m) => rowDocKeyFn(m) === consensus);
  const primaryRow = diversifiedMatches.find((m) => rowDocKeyFn(m) === primaryKey);
  if (!consensusRow || !primaryRow) return primaryKey;

  const cTitle = rowTitleFn(consensusRow);
  const pTitle = rowTitleFn(primaryRow);
  const topics = activeTopicsForQuery(userQuery, sessionRoute);

  for (const topic of topics) {
    const consensusMatches = rowMatchesTopic(
      cTitle,
      consensusRow.metadata ?? null,
      topic
    );
    if (!consensusMatches) continue;

    if (rowBlockedForTopic(pTitle, topic)) return consensus;
    if (topic.id === 'fy_hopeful' && titleLooksLikeGenericJulyMomentum(pTitle)) {
      return consensus;
    }
    if (
      topic.id === 'momentum_kitchen_warranty' &&
      /momentum meet april 29/i.test(pTitle.toLowerCase())
    ) {
      return consensus;
    }
    if (
      topic.id === 'marketing_rhys' &&
      (/leads tracking|done with you/i.test(pTitle.toLowerCase()) ||
        /cash flow for tradies/i.test(pTitle.toLowerCase()))
    ) {
      return consensus;
    }
    if (
      topic.id === 'systemology' &&
      /tradie systems map checklist/i.test(pTitle.toLowerCase())
    ) {
      return consensus;
    }
    if (
      topic.id === 'hire_apprentice' &&
      /expert sessions done with you screening/i.test(pTitle.toLowerCase())
    ) {
      return consensus;
    }
  }

  const anchor = extractExplicitSessionTitle(userQuery);
  if (
    anchor &&
    /momentum meet april 29/i.test(pTitle.toLowerCase()) &&
    sessionTitleMatchScore(anchor, pTitle) < 40
  ) {
    return consensus;
  }

  return primaryKey;
}

/** Correct misrouted primary using active topic title patterns. */
export function correctPrimaryForActiveTopics(
  primaryKey: string,
  userQuery: string,
  sessionRoute: SessionRoute | null,
  rerankMatches: MatchRow[],
  vectorMatches: MatchRow[],
  rowDocKey: (row: MatchRow) => string,
  rowTitle: (row: MatchRow) => string
): string {
  const topics = activeTopicsForQuery(userQuery, sessionRoute);
  if (topics.length === 0) return primaryKey;

  const scan = [...rerankMatches, ...vectorMatches.slice(0, 36)];
  const primaryRow = rerankMatches.find((m) => rowDocKey(m) === primaryKey);
  const primaryTitle = primaryRow ? rowTitle(primaryRow) : '';

  for (const topic of topics) {
    const preferredPatterns = topic.primaryTitlePatterns;
    if (preferredPatterns?.length) {
      const primaryPreferred = preferredPatterns.some((re) =>
        re.test(primaryTitle.toLowerCase())
      );
      if (!primaryPreferred) {
        for (const row of scan) {
          const title = rowTitle(row);
          if (!preferredPatterns.some((re) => re.test(title.toLowerCase()))) {
            continue;
          }
          if (
            topic.id.startsWith('pdf_') &&
            row.metadata?.source_type === 'video_transcript'
          ) {
            continue;
          }
          return rowDocKey(row);
        }
      }
    }

    if (primaryTitle && rowMatchesTopic(primaryTitle, primaryRow?.metadata ?? null, topic)) {
      continue;
    }
    if (primaryTitle && rowBlockedForTopic(primaryTitle, topic)) {
      for (const row of scan) {
        if (rowMatchesTopic(rowTitle(row), row.metadata ?? null, topic)) {
          return rowDocKey(row);
        }
      }
    }
  }

  return primaryKey;
}

export function shouldSingleCitationForRoutedTopic(
  userQuery: string,
  sessionRoute: SessionRoute | null,
  primaryKey: string,
  rerankMatches: MatchRow[],
  rowDocKey: (row: MatchRow) => string,
  rowTitle: (row: MatchRow) => string
): boolean {
  const topics = activeTopicsForQuery(userQuery, sessionRoute);
  const singleCitationTopic = topics.find((t) => t.singleCitationWhenPrimary);
  if (!singleCitationTopic) return false;

  const row = rerankMatches.find((m) => rowDocKey(m) === primaryKey);
  if (!row) return false;
  return rowMatchesTopic(
    rowTitle(row),
    row.metadata ?? null,
    singleCitationTopic
  );
}

export function shouldFetchRhysTitleKeywords(
  userQuery: string,
  rewrite: RagLlmRewrite | null
): boolean {
  return (
    isQueryForTopic(userQuery, 'marketing_rhys') ||
    Boolean(rewrite?.speakerHints.some((h) => /rhys/i.test(h)))
  );
}
