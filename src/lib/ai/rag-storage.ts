import type { RagSource } from '@/lib/types';
import {
  ragSourceFromRow,
  isVideoTranscriptRow,
  videoTranscriptCitationTitle,
} from '@/lib/rag-source-from-row';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { embedTexts } from '@/lib/ai/openai-embed';
import { rerankPassages } from '@/lib/ai/rerank';
import {
  PHRASE_MATCH_SIMILARITY,
  mergeRetrievalCandidates,
  type MatchRow,
} from '@/lib/ai/rag-merge';
import {
  chunkContainsPhrase,
  phraseSearchCandidates,
} from '@/lib/ai/rag-phrase-search';
import {
  fetchTitleKeywordMatches,
  TITLE_KEYWORD_MATCH_SIMILARITY,
} from '@/lib/ai/rag-title-keyword-search';
import {
  entityAnchorTerms,
  hasEntityStyleTerms,
  signalPhrasesFromQuery,
  titleSearchTerms,
} from '@/lib/ai/rag-query-terms';
import {
  filterMatchesToSessions,
  scoreSessionDocuments,
  selectTopSessionDocKeys,
  topDocKeysByTitleKeywordHits,
} from '@/lib/ai/rag-session-select';
import type { PhraseChunkRow } from '@/lib/ai/rag-phrase-search';
import { diversifyMatchesByDoc } from '@/lib/ai/rag-diversify-matches';
import {
  resolveRagIntentParams,
  type RagQueryIntent,
} from '@/lib/ai/rag-query-mode';
import {
  buildEmbedInputs,
  extraEmbedInputsAfterRewrite,
} from '@/lib/ai/rag-embed-inputs';
import {
  classifyRetrievalMode,
  shouldUseSessionCardRouting,
  type RetrievalMode,
} from '@/lib/ai/rag-retrieval-mode';
import {
  fetchContentChunksForSessionCard,
  fetchSessionCardMatches,
} from '@/lib/ai/rag-session-card-fetch';
import {
  buildLexicalQuery,
  fetchLexicalMatchesParallel,
  mergePhraseRows,
  mergeTitleKeywordRows,
} from '@/lib/ai/rag-lexical-fetch';
import { isSessionCardRow } from '@/lib/ai/session-card';
import {
  llmRewriteQueriesForRag,
  softRewriteFromTopicHint,
  type RagRewriteMeta,
} from '@/lib/ai/rag-llm-query-rewrite';
import { computeRewriteGate } from '@/lib/ai/rag-rewrite-gate';
import {
  mergeRagRewrites,
  queryHintsForceDocKeys,
} from '@/lib/ai/rag-query-heuristics';
import {
  correctExplicitSessionPrimaryDocKey,
  extractExplicitSessionTitle,
  sessionTitleMatchScore,
} from '@/lib/ai/rag-explicit-session';
import {
  applyAllQueryAwareSessionPenalties,
  correctMisroutedPrimaryDocKey,
  isGenericLeadershipCollisionTitle,
  shouldSingleCitationForMeetingRhythm,
} from '@/lib/ai/rag-retrieval-penalties';
import {
  filterTitleKeywordForceKeys,
  shouldPromoteTitleKeywordAnchor,
} from '@/lib/ai/rag-title-anchor-policy';
import {
  isQueryForTopic,
  shouldFetchRhysTitleKeywords,
} from '@/lib/ai/rag-topic-engine';
import {
  fetchRouteAnchorChunks,
  mergeRouteAnchorsIntoMatches,
} from '@/lib/ai/rag-route-anchor-fetch';
import {
  buildDocPool,
  filterToDocPool,
  type DocPoolResult,
} from '@/lib/ai/rag-doc-pool';
import {
  routeQueryIntent,
  type RagIntentRoute,
} from '@/lib/ai/rag-intent-router';
import {
  docKeysForRoute,
  prioritizeRoutedDocKeys,
  resolveSessionRoute,
  shouldLockPrimaryToRoute,
  shouldRerankWithinRouteOnly,
  shouldSkipRerank,
  vectorConsensusConflictsWithRoute,
} from '@/lib/ai/rag-session-router';
import {
  dominantVectorDocKey,
  fetchMergedVectorMatches,
  sessionAgreementDocKeys,
} from '@/lib/ai/rag-multi-vector';

const DEFAULT_MAX_SOURCE_DOCS = 2;
const DEFAULT_MAX_CHUNKS_PER_DOC = 4;
const DEFAULT_MAX_KB_LINKS = 2;
/** Lower = more chunks in the candidate pool (fewer false empty retrievals). */
const DEFAULT_MATCH_THRESHOLD = 0.22;
const DEFAULT_VECTOR_MATCH_COUNT = 56;
const DEFAULT_CONTEXT_CHUNKS = 12;

function metaString(m: Record<string, unknown> | null, key: string): string | null {
  if (!m || typeof m[key] !== 'string') return null;
  const v = (m[key] as string).trim();
  return v || null;
}

export function rowDocKey(row: MatchRow): string {
  if (isVideoTranscriptRow(row.metadata)) {
    const url = metaString(row.metadata, 'video_url');
    if (url) {
      const q = url.indexOf('?');
      return `video:\0${q === -1 ? url : url.slice(0, q)}`;
    }
    // One JSON file per session — avoids many "Momentum Meet" files collapsing to one doc.
    const sourceFile = metaString(row.metadata, 'source_file');
    if (sourceFile) return `video:\0file:${sourceFile}`;
    const name = metaString(row.metadata, 'video_name');
    if (name) return `video:\0${name}`;
  }
  const bucket =
    metaString(row.metadata, 'storage_bucket') ??
    process.env.RAG_STORAGE_BUCKET ??
    'Rag';
  const objectPath = metaString(row.metadata, 'storage_path');
  if (bucket && objectPath) return `${bucket}\0${objectPath}`;
  return `row:${row.id}`;
}

export function rowTitle(row: MatchRow): string {
  if (isVideoTranscriptRow(row.metadata)) {
    return videoTranscriptCitationTitle(row.metadata, row.source_title);
  }
  const objectPath = metaString(row.metadata, 'storage_path');
  return (
    row.source_title ||
    objectPath?.split('/').pop()?.replace(/\.pdf$/i, '') ||
    'Knowledge base'
  );
}

function passageBodyForRerank(row: MatchRow): string {
  const title = rowTitle(row);
  const type = isVideoTranscriptRow(row.metadata) ? 'Video transcript' : 'PDF';
  return `[${type}] ${title}\n\n${row.content.trim()}`;
}

function selectChunksFromRerank(
  order: number[],
  matches: MatchRow[],
  maxDocs: number,
  maxChunks: number
): MatchRow[] {
  const pick: MatchRow[] = [];
  const pickIds = new Set<string>();

  const add = (row: MatchRow) => {
    if (pickIds.has(row.id)) return;
    pickIds.add(row.id);
    pick.push(row);
  };

  if (order.length === 0) return pick;

  const primaryKey = rowDocKey(matches[order[0]]!);

  for (const idx of order) {
    if (pick.length >= maxChunks) break;
    const row = matches[idx];
    if (row && rowDocKey(row) === primaryKey) add(row);
  }

  const allowedDocs = new Set<string>([primaryKey]);

  for (const idx of order) {
    if (allowedDocs.size >= maxDocs || pick.length >= maxChunks) break;
    const row = matches[idx];
    if (!row) continue;
    const key = rowDocKey(row);
    if (allowedDocs.has(key)) continue;
    allowedDocs.add(key);
    add(row);
  }

  for (const idx of order) {
    if (pick.length >= maxChunks) break;
    const row = matches[idx];
    if (!row) continue;
    const key = rowDocKey(row);
    if (key === primaryKey || !allowedDocs.has(key)) continue;
    add(row);
  }

  if (pick.length === 0) add(matches[order[0]]!);
  return pick;
}

/** Put primary-document chunks first in the prompt (first Source: block = main authority). */
/** Comparison queries: ensure each named session appears in pick (golden + coach). */
function ensureComparisonDocsInPick(
  pick: MatchRow[],
  effectiveOrder: number[],
  rerankMatches: MatchRow[],
  userQuery: string,
  maxChunks: number,
  rowTitle: (row: MatchRow) => string
): MatchRow[] {
  if (!/\bcompare\b/i.test(userQuery)) return pick;

  const lower = userQuery.toLowerCase();
  const required: ((title: string) => boolean)[] = [];
  if (/\bget off the tools\b/i.test(lower)) {
    required.push((t) => /get off the tools/i.test(t));
  }
  if (/\bjoe pane\b/i.test(lower)) {
    required.push((t) => /joe pane/i.test(t));
  }
  if (required.length < 2) return pick;

  const seenIds = new Set(pick.map((r) => r.id));
  const out = [...pick];

  for (const pred of required) {
    if (out.some((r) => pred(rowTitle(r).toLowerCase()))) continue;
    for (const idx of effectiveOrder) {
      const row = rerankMatches[idx]!;
      if (!pred(rowTitle(row).toLowerCase()) || seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      out.push(row);
      break;
    }
  }

  return out.slice(0, maxChunks);
}

function videoSegmentStartSeconds(title: string): number {
  const m = title.match(/\((\d{1,2}):(\d{2})/);
  if (!m) return 999999;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

/** Strong topic routes on video JSON: phrase hits first, then earliest segments in the file. */
function ensureRoutedVideoChunksInPick(
  pick: MatchRow[],
  matchPool: MatchRow[],
  primaryKey: string,
  phraseChunkIds: Set<string>,
  maxChunks: number,
  titleFn: (row: MatchRow) => string
): MatchRow[] {
  if (!primaryKey) return pick;

  const primaryRow =
    pick.find((r) => rowDocKey(r) === primaryKey) ??
    matchPool.find((r) => rowDocKey(r) === primaryKey);
  if (!primaryRow || !isVideoTranscriptRow(primaryRow.metadata)) return pick;

  const candidates = matchPool.filter((r) => rowDocKey(r) === primaryKey);
  if (candidates.length === 0) return pick;

  const sorted = [...candidates].sort((a, b) => {
    const ap = phraseChunkIds.has(a.id) ? 1 : 0;
    const bp = phraseChunkIds.has(b.id) ? 1 : 0;
    if (bp !== ap) return bp - ap;
    const at = videoSegmentStartSeconds(titleFn(a));
    const bt = videoSegmentStartSeconds(titleFn(b));
    if (at !== bt) return at - bt;
    return (b.similarity ?? 0) - (a.similarity ?? 0);
  });

  return sorted.slice(0, maxChunks);
}

function orderPickPrimaryFirst(
  pick: MatchRow[],
  primaryKey: string
): MatchRow[] {
  const primary: MatchRow[] = [];
  const rest: MatchRow[] = [];
  for (const row of pick) {
    if (rowDocKey(row) === primaryKey) primary.push(row);
    else rest.push(row);
  }
  return [...primary, ...rest];
}

/** Best matching document among title-keyword hits (entity names or title terms). */
function bestTitleKeywordDocKey(
  userQuery: string,
  titleKeywordRows: PhraseChunkRow[]
): string | null {
  if (titleKeywordRows.length === 0) return null;

  const entityTerms = entityAnchorTerms(userQuery);
  const terms =
    entityTerms.length > 0 ? entityTerms : titleSearchTerms(userQuery, 8);
  if (terms.length === 0) return null;

  const scores = new Map<string, number>();
  const sortedTerms = [...terms].sort((a, b) => b.length - a.length);

  for (const row of titleKeywordRows) {
    const key = rowDocKey(row as MatchRow);
    const title = row.source_title.toLowerCase();
    if (
      isQueryForTopic(userQuery, 'nic_waz_meeting') &&
      isGenericLeadershipCollisionTitle(row.source_title)
    ) {
      continue;
    }
    let score = 1;
    const explicitAnchor = extractExplicitSessionTitle(userQuery);
    if (explicitAnchor) {
      score += Math.round(
        sessionTitleMatchScore(explicitAnchor, row.source_title) * 0.6
      );
    }
    for (const term of sortedTerms) {
      const t = term.toLowerCase();
      if (t.length < 3) continue;
      if (title.includes(t)) score += Math.min(t.length * 2, 28);
    }
    for (const term of sortedTerms) {
      const t = term.toLowerCase();
      if (t.length >= 8 && title.includes(t)) {
        score += t.length * 2;
        break;
      }
    }
    scores.set(key, (scores.get(key) ?? 0) + score);
  }

  let bestKey: string | null = null;
  let bestScore = 0;
  for (const [key, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  const minScore = entityTerms.length > 0 ? 12 : 7;
  if (bestScore < minScore) return null;
  return bestKey;
}

function titleLooksLikeGenericJulyMomentum(title: string): boolean {
  const t = title.toLowerCase();
  return /momentum meet/i.test(t) && /\bjuly\b/i.test(t);
}

/** When literal phrase hits exist, put matching chunks first (beats wrong rerank). */
function reorderForPhraseAnchor(
  effectiveOrder: number[],
  matches: MatchRow[],
  phraseChunkIds: Set<string>,
  phraseCandidates: string[]
): number[] {
  if (phraseCandidates.length === 0 || phraseChunkIds.size === 0) {
    return effectiveOrder;
  }

  const phraseFirst: number[] = [];
  const rest: number[] = [];
  for (const idx of effectiveOrder) {
    const row = matches[idx]!;
    if (
      phraseChunkIds.has(row.id) &&
      chunkContainsPhrase(row.content, phraseCandidates)
    ) {
      phraseFirst.push(idx);
    } else {
      rest.push(idx);
    }
  }
  if (phraseFirst.length === 0) return effectiveOrder;
  return [...phraseFirst, ...rest];
}

function reorderForTitleKeywordAnchor(
  effectiveOrder: number[],
  matches: MatchRow[],
  titleKeywordChunkIds: Set<string>,
  titleKeywordRows: PhraseChunkRow[],
  userQuery: string,
  vectorConsensus: string | null = null,
  topicRoutedKeys: string[] = []
): number[] {
  if (titleKeywordChunkIds.size === 0 && titleKeywordRows.length === 0) {
    return effectiveOrder;
  }

  const anchorKey = bestTitleKeywordDocKey(userQuery, titleKeywordRows);
  if (!anchorKey) return effectiveOrder;

  const anchorRow = titleKeywordRows.find(
    (r) => rowDocKey(r as MatchRow) === anchorKey
  );
  if (
    !shouldPromoteTitleKeywordAnchor({
      userQuery,
      titleAnchorKey: anchorKey,
      anchorTitle: anchorRow?.source_title ?? '',
      vectorConsensus,
      topicRoutedKeys,
    })
  ) {
    return effectiveOrder;
  }

  const top = effectiveOrder[0];
  const topRow = top !== undefined ? matches[top] : undefined;
  if (topRow && rowDocKey(topRow) === anchorKey) {
    return effectiveOrder;
  }

  const anchorFirst: number[] = [];
  const rest: number[] = [];
  for (const idx of effectiveOrder) {
    if (rowDocKey(matches[idx]!) === anchorKey) anchorFirst.push(idx);
    else rest.push(idx);
  }
  if (anchorFirst.length === 0) return effectiveOrder;
  return [...anchorFirst, ...rest];
}

/** Primary document = rerank winner (first content chunk, not session card). */
function primaryDocKeyFromRerankOrder(
  effectiveOrder: number[],
  rerankMatches: MatchRow[]
): string | null {
  for (const idx of effectiveOrder) {
    const row = rerankMatches[idx];
    if (!row || isSessionCardRow(row.metadata)) continue;
    return rowDocKey(row);
  }
  const first = effectiveOrder[0];
  if (first === undefined) return null;
  return rowDocKey(rerankMatches[first]!);
}

function resolveCitationDocKeys(
  pick: MatchRow[],
  primaryKey: string | null,
  maxLinks: number,
  intent: RagQueryIntent | null
): Set<string> {
  if (!primaryKey) return new Set();

  const out = new Set<string>([primaryKey]);

  if (intent === 'comparison') {
    for (const row of pick) {
      const key = rowDocKey(row);
      if (isSessionCardRow(row.metadata)) continue;
      out.add(key);
      if (out.size >= maxLinks) break;
    }
  }

  return out;
}

export type RagRetrievalOptions = {
  /** One-line topic from conversation summary — vague queries only. */
  topicHint?: string | null;
};

export type RagPipelineDebug = {
  vectorCount: number;
  titleKeywordCount: number;
  phraseCount: number;
  ftsCount: number;
  primaryTitle: string | null;
  pickTitles: string[];
  citationTitles: string[];
  topVectorTitles: string[];
  llmRewriteUsed: boolean;
  llmSearchQueries: string[];
  vectorQueryCount: number;
  sessionAgreementDocs: string[];
  routedTopicId: string | null;
  routedLabel: string | null;
  routedConfidence: number | null;
  routedDocKeys: string[];
  rewriteScore: number | null;
  rewriteMode: 'off' | 'soft' | 'full' | null;
  rewriteSignals: string[];
  topicHintUsed: boolean;
  retrievalMode: RetrievalMode | null;
  intentRouterIntents: string[];
  intentRouterConfidence: number | null;
  intentRouterSource: string | null;
  docPoolKeys: string[];
  docPoolSource: string | null;
};

export type StorageRagResult = {
  contextBlock: string;
  sources: RagSource[];
  /** Main TiB document used for this answer (shown to model + UI). */
  primarySourceTitle: string | null;
  queryIntent: RagQueryIntent | null;
  answerGuidance: string | null;
};

export async function retrieveStorageRag(
  userQuery: string,
  openaiKey: string,
  options?: RagRetrievalOptions
): Promise<StorageRagResult | null> {
  const { result } = await runRagPipeline(userQuery, openaiKey, false, options);
  return result;
}

export async function retrieveStorageRagWithDebug(
  userQuery: string,
  openaiKey: string,
  options?: RagRetrievalOptions
): Promise<{ result: StorageRagResult | null; debug: RagPipelineDebug }> {
  return runRagPipeline(userQuery, openaiKey, true, options);
}

async function runRagPipeline(
  userQuery: string,
  openaiKey: string,
  collectDebug: boolean,
  options?: RagRetrievalOptions
): Promise<{ result: StorageRagResult | null; debug: RagPipelineDebug }> {
  const emptyDebug: RagPipelineDebug = {
    vectorCount: 0,
    titleKeywordCount: 0,
    phraseCount: 0,
    ftsCount: 0,
    primaryTitle: null,
    pickTitles: [],
    citationTitles: [],
    topVectorTitles: [],
    llmRewriteUsed: false,
    llmSearchQueries: [],
    vectorQueryCount: 0,
    sessionAgreementDocs: [],
    routedTopicId: null,
    routedLabel: null,
    routedConfidence: null,
    routedDocKeys: [],
    rewriteScore: null,
    rewriteMode: null,
    rewriteSignals: [],
    topicHintUsed: false,
    retrievalMode: null,
    intentRouterIntents: [],
    intentRouterConfidence: null,
    intentRouterSource: null,
    docPoolKeys: [],
    docPoolSource: null,
  };

  try {
    const threshold = parseFloat(
      process.env.RAG_MATCH_THRESHOLD ?? String(DEFAULT_MATCH_THRESHOLD)
    );
    const vectorMatchCount = parseInt(
      process.env.RAG_VECTOR_MATCH_COUNT ?? String(DEFAULT_VECTOR_MATCH_COUNT),
      10
    );
    const maxChunks = parseInt(
      process.env.RAG_CONTEXT_CHUNKS ?? String(DEFAULT_CONTEXT_CHUNKS),
      10
    );

    const maxDocsRaw = parseInt(
      process.env.RAG_MAX_SOURCE_PDFS ??
        process.env.RAG_MAX_SOURCE_DOCS ??
        String(DEFAULT_MAX_SOURCE_DOCS),
      10
    );
    const maxDocs =
      Number.isFinite(maxDocsRaw) && maxDocsRaw >= 1
        ? Math.min(maxDocsRaw, 5)
        : DEFAULT_MAX_SOURCE_DOCS;

    const maxKbLinksRaw = parseInt(
      process.env.RAG_KNOWLEDGE_BASE_MAX_LINKS ?? String(DEFAULT_MAX_KB_LINKS),
      10
    );
    const maxKbLinks =
      Number.isFinite(maxKbLinksRaw) && maxKbLinksRaw >= 1
        ? Math.min(maxKbLinksRaw, 5)
        : DEFAULT_MAX_KB_LINKS;

    const intentParams = resolveRagIntentParams(userQuery);
    const retrievalMode = classifyRetrievalMode(userQuery);
    const rewriteGate = computeRewriteGate(userQuery);
    const topicHint = options?.topicHint?.trim() || null;

    const intentRoute: RagIntentRoute = await routeQueryIntent(
      userQuery,
      topicHint
    );
    const sessionRoute = resolveSessionRoute(userQuery, intentRoute);

    const forceSingle =
      (process.env.RAG_SINGLE_SOURCE_PDF ?? 'false').toLowerCase() === 'true';
    const singleSource = forceSingle || intentParams.singleSource;
    const effectiveMaxDocs = Math.min(maxDocs, intentParams.maxDocs);
    const effectiveMaxKbLinks = Math.min(maxKbLinks, intentParams.maxKbLinks);

    const admin = createServiceRoleClient();
    const ftsLimit = parseInt(process.env.RAG_FTS_MATCH_COUNT ?? '22', 10) || 22;
    const matchThreshold = Number.isFinite(threshold)
      ? threshold
      : DEFAULT_MATCH_THRESHOLD;
    const matchCount = Number.isFinite(vectorMatchCount)
      ? vectorMatchCount
      : DEFAULT_VECTOR_MATCH_COUNT;

    const heuristicRewrite = mergeRagRewrites(userQuery, null, intentRoute);
    const earlyLexical = buildLexicalQuery(userQuery, heuristicRewrite);

    const [llmRewriteResult, earlyLexicalResult, routeAnchors, sessionCards] =
      await Promise.all([
        shouldUseSessionCardRouting(retrievalMode)
          ? Promise.resolve({
              rewrite: null,
              meta: {
                gate: rewriteGate,
                mode: rewriteGate.mode,
                topicHintUsed: false,
              },
            })
          : llmRewriteQueriesForRag({
              userQuery,
              gate: rewriteGate,
              topicHint,
            }),
        fetchLexicalMatchesParallel(
          admin,
          userQuery,
          earlyLexical,
          heuristicRewrite?.topicPhrases ?? [],
          ftsLimit
        ),
        sessionRoute
          ? fetchRouteAnchorChunks(admin, sessionRoute)
          : Promise.resolve([] as MatchRow[]),
        shouldUseSessionCardRouting(retrievalMode)
          ? fetchSessionCardMatches(admin, userQuery)
          : Promise.resolve([] as MatchRow[]),
      ]);

    const rewriteMeta: RagRewriteMeta = llmRewriteResult.meta;
    let llmOnlyRewrite = llmRewriteResult.rewrite;
    if (!llmOnlyRewrite && rewriteGate.mode === 'soft' && topicHint) {
      llmOnlyRewrite = softRewriteFromTopicHint(userQuery, topicHint);
    }

    const rewrite = mergeRagRewrites(userQuery, llmOnlyRewrite, intentRoute);
    const fullLexical = buildLexicalQuery(userQuery, rewrite);

    let {
      titleKeywordRows,
      phraseRows,
      ftsRows,
      ftsHitIds,
      ftsRanks,
    } = earlyLexicalResult;

    const lexicalExpanded =
      fullLexical.trim().toLowerCase() !== earlyLexical.trim().toLowerCase();

    const embedInputsInitial = buildEmbedInputs(
      userQuery,
      heuristicRewrite,
      retrievalMode
    );
    const extraEmbedInputs = rewrite
      ? extraEmbedInputsAfterRewrite(
          userQuery,
          heuristicRewrite,
          rewrite,
          retrievalMode
        )
      : [];

    const sessionCardContent =
      sessionCards.length > 0
        ? await fetchContentChunksForSessionCard(admin, sessionCards[0]!)
        : [];

    const [embeddingsInitial, supplementalLexical, extraEmbeddings] =
      await Promise.all([
        embedTexts(embedInputsInitial, openaiKey),
        lexicalExpanded
          ? fetchLexicalMatchesParallel(
              admin,
              userQuery,
              fullLexical,
              rewrite?.topicPhrases ?? [],
              ftsLimit
            )
          : Promise.resolve(null),
        extraEmbedInputs.length > 0
          ? embedTexts(extraEmbedInputs, openaiKey)
          : Promise.resolve([] as number[][]),
      ]);

    const embeddings = [...embeddingsInitial, ...extraEmbeddings];

    if (supplementalLexical) {
      titleKeywordRows = mergeTitleKeywordRows(
        titleKeywordRows,
        supplementalLexical.titleKeywordRows
      );
      phraseRows = mergePhraseRows(
        phraseRows,
        supplementalLexical.phraseRows
      );
      for (const row of supplementalLexical.ftsRows) {
        if (!ftsHitIds.has(row.id)) {
          ftsHitIds.add(row.id);
          ftsRows.push(row);
        }
        const rank = supplementalLexical.ftsRanks.get(row.id);
        if (rank != null && !ftsRanks.has(row.id)) {
          ftsRanks.set(row.id, rank);
        }
      }
    }

    if (shouldFetchRhysTitleKeywords(userQuery, rewrite)) {
      const rhysRows = await fetchTitleKeywordMatches(
        admin,
        'Expert Session with Rhys from Kaha Digital'
      );
      titleKeywordRows = mergeTitleKeywordRows(titleKeywordRows, rhysRows);
    }

    const titleKeywordIds = new Set(titleKeywordRows.map((p) => p.id));
    const phraseIds = new Set(phraseRows.map((p) => p.id));

    const phraseCandidates = [
      ...new Set([
        ...phraseSearchCandidates(userQuery),
        ...(rewrite?.topicPhrases ?? []),
      ]),
    ];

    const { merged: vectorMatches, perQuery: vectorPerQuery } =
      await fetchMergedVectorMatches(
        admin,
        embeddings,
        matchThreshold,
        matchCount
      );

    if (routeAnchors.length > 0) {
      for (const row of routeAnchors) {
        titleKeywordIds.add(row.id);
      }
    }

    const sessionAgreementDocs =
      rewrite && vectorPerQuery.length >= 2
        ? sessionAgreementDocKeys(vectorPerQuery, rowDocKey, 5, 2)
        : [];

    let { matches, titleKeywordChunkIds, phraseChunkIds, ftsChunkIds } =
      mergeRetrievalCandidates(
        vectorMatches,
        {
          rows: titleKeywordRows,
          similarity: TITLE_KEYWORD_MATCH_SIMILARITY,
          ids: titleKeywordIds,
        },
        {
          rows: phraseRows,
          similarity: PHRASE_MATCH_SIMILARITY,
          ids: phraseIds,
        },
        {
          rows: ftsRows,
          similarity: 0,
          ids: ftsHitIds,
          ranks: ftsRanks,
        }
      );

    if (matches.length === 0) {
      return { result: null, debug: emptyDebug };
    }

    let routedDocKeys: string[] = [];
    if (routeAnchors.length > 0) {
      matches = mergeRouteAnchorsIntoMatches(matches, routeAnchors);
    }

    if (sessionCards.length > 0) {
      matches = mergeRouteAnchorsIntoMatches(matches, sessionCards);
      if (sessionCardContent.length > 0) {
        matches = mergeRouteAnchorsIntoMatches(matches, sessionCardContent);
      }
    }

    const routingRows = [
      ...matches.map((row) => ({
        row,
        rowDocKey,
        rowTitle,
      })),
      ...titleKeywordRows.map((row) => ({
        row: row as MatchRow,
        rowDocKey,
        rowTitle,
      })),
      ...vectorMatches.slice(0, 36).map((row) => ({
        row,
        rowDocKey,
        rowTitle,
      })),
    ];
    const titleByDocKey = new Map<string, string>();
    for (const { row, rowDocKey: dk, rowTitle: rt } of routingRows) {
      titleByDocKey.set(dk(row as MatchRow), rt(row as MatchRow));
    }

    routedDocKeys = sessionRoute
      ? docKeysForRoute(sessionRoute, routingRows)
      : [];
    if (sessionRoute && routedDocKeys.length > 1) {
      routedDocKeys = prioritizeRoutedDocKeys(
        userQuery,
        sessionRoute,
        routedDocKeys,
        titleByDocKey
      );
    }

    let docPoolResult: DocPoolResult | null = null;
    docPoolResult = buildDocPool({
      matches,
      vectorMatches,
      titleKeywordRows,
      intentRoute,
      sessionRoute,
      routedDocKeys,
      sessionAgreementDocs,
      rowDocKey,
      rowTitle,
    });
    matches = filterToDocPool(matches, docPoolResult, rowDocKey);

    const sessionFirstEnabled =
      (process.env.RAG_SESSION_FIRST ?? 'true').toLowerCase() !== 'false';

    let sessionFiltered = matches;

    if (sessionFirstEnabled) {
      const topKRaw = parseInt(
        process.env.RAG_SESSION_TOP_K ??
          String(Math.max(7, effectiveMaxDocs + 3)),
        10
      );
      const sessionTopK =
        intentParams.intent === 'comparison'
          ? Math.max(6, topKRaw)
          : Number.isFinite(topKRaw) && topKRaw >= 2
            ? Math.min(topKRaw, 10)
            : 5;

      const sessionScores = scoreSessionDocuments(matches, {
        userQuery,
        titleKeywordRows,
        titleKeywordIds,
        phraseChunkIds: phraseIds,
        ftsChunkIds: ftsHitIds,
        rowDocKey,
      });

      const vectorConsensus = dominantVectorDocKey(
        vectorMatches,
        rowDocKey,
        10,
        3
      );
      const trustVectorConsensus = !vectorConsensusConflictsWithRoute(
        sessionRoute,
        routedDocKeys,
        vectorConsensus
      );
      if (vectorConsensus && trustVectorConsensus) {
        sessionScores.set(
          vectorConsensus,
          (sessionScores.get(vectorConsensus) ?? 0) + 0.38
        );
      }

      const forceKeys: string[] = [];
      if (sessionCards.length > 0) {
        forceKeys.push(rowDocKey(sessionCards[0]!));
      }
      if (sessionRoute && routedDocKeys.length > 0) {
        for (const k of routedDocKeys) {
          sessionScores.set(k, (sessionScores.get(k) ?? 0) + 0.55);
          forceKeys.push(k);
        }
      }

      if (vectorConsensus && trustVectorConsensus) forceKeys.push(vectorConsensus);

      const titleAnchor = bestTitleKeywordDocKey(userQuery, titleKeywordRows);
      if (titleAnchor) {
        const anchorRow = titleKeywordRows.find(
          (r) => rowDocKey(r as MatchRow) === titleAnchor
        );
        const anchorTitle = anchorRow
          ? rowTitle(anchorRow as MatchRow)
          : '';
        const skipWeakJulyAnchor =
          vectorConsensus &&
          titleAnchor !== vectorConsensus &&
          anchorRow &&
          titleLooksLikeGenericJulyMomentum(anchorTitle);
        const promoteTitleAnchor =
          !skipWeakJulyAnchor &&
          shouldPromoteTitleKeywordAnchor({
            userQuery,
            titleAnchorKey: titleAnchor,
            anchorTitle,
            vectorConsensus,
            topicRoutedKeys: routedDocKeys,
          });
        if (promoteTitleAnchor) forceKeys.push(titleAnchor);
      }

      const titleHitKeys = filterTitleKeywordForceKeys(
        userQuery,
        topDocKeysByTitleKeywordHits(titleKeywordRows, rowDocKey, 2),
        vectorConsensus,
        routedDocKeys,
        trustVectorConsensus
      );
      forceKeys.push(...titleHitKeys);

      if (sessionAgreementDocs[0]) {
        forceKeys.push(sessionAgreementDocs[0]);
      }

      const hintForceKeys = queryHintsForceDocKeys(
        userQuery,
        matches,
        titleKeywordRows,
        rowDocKey,
        rowTitle,
        sessionRoute
      );
      forceKeys.push(...hintForceKeys);

      applyAllQueryAwareSessionPenalties(
        userQuery,
        sessionScores,
        matches,
        titleKeywordRows,
        rowDocKey,
        rowTitle,
        sessionRoute
      );

      const allowedDocs = selectTopSessionDocKeys(
        sessionScores,
        sessionTopK,
        forceKeys
      );

      sessionFiltered = filterMatchesToSessions(
        matches,
        allowedDocs,
        rowDocKey
      );

      if (sessionFiltered.length === 0) {
        const topByScore = selectTopSessionDocKeys(sessionScores, sessionTopK, []);
        sessionFiltered = filterMatchesToSessions(
          matches,
          topByScore,
          rowDocKey
        );
        if (sessionFiltered.length === 0) {
          sessionFiltered = matches;
        }
      }
    }

    const contentMatches = sessionFiltered.filter(
      (m) => !isSessionCardRow(m.metadata)
    );
    const poolForChunks =
      contentMatches.length > 0 ? contentMatches : sessionFiltered;

    const maxPerDocRaw = parseInt(
      process.env.RAG_MAX_CHUNKS_PER_DOC ?? String(DEFAULT_MAX_CHUNKS_PER_DOC),
      10
    );
    let maxPerDoc =
      Number.isFinite(maxPerDocRaw) && maxPerDocRaw >= 1
        ? Math.min(maxPerDocRaw, 12)
        : DEFAULT_MAX_CHUNKS_PER_DOC;

    if (
      sessionRoute &&
      shouldRerankWithinRouteOnly(sessionRoute) &&
      routedDocKeys.length === 1
    ) {
      maxPerDoc = Math.max(maxPerDoc, Math.min(maxChunks, 8));
    }

    const diversifiedMatches = diversifyMatchesByDoc(
      poolForChunks,
      maxPerDoc,
      rowDocKey
    );

    let rerankMatches = diversifiedMatches;
    if (
      sessionRoute &&
      shouldRerankWithinRouteOnly(sessionRoute) &&
      routedDocKeys.length > 0
    ) {
      const routedSet = new Set(routedDocKeys);
      const inRoute = diversifiedMatches.filter((m) =>
        routedSet.has(rowDocKey(m))
      );
      if (inRoute.length >= 2) rerankMatches = inRoute;
    }

    const passages = rerankMatches.map((m, i) => {
      let text = passageBodyForRerank(m);
    if (titleKeywordChunkIds.has(m.id)) {
      text = `[TITLE KEYWORD MATCH]\n${text}`;
    } else if (phraseChunkIds.has(m.id)) {
      text = `[EXACT PHRASE MATCH]\n${text}`;
    } else if (ftsChunkIds.has(m.id)) {
      text = `[FULL-TEXT MATCH]\n${text}`;
    }
    return {
      index: i,
      text,
      title: rowTitle(m),
      similarity: typeof m.similarity === 'number' ? m.similarity : 0,
    };
  });

  let order: number[];
  const dropSet = new Set<number>();
  if (shouldSkipRerank(sessionRoute, intentParams.intent)) {
    order = rerankMatches
      .map((_, i) => i)
      .sort(
        (a, b) =>
          (rerankMatches[b]!.similarity ?? 0) -
          (rerankMatches[a]!.similarity ?? 0)
      );
  } else {
    try {
      const reranked = await rerankPassages(userQuery, passages);
      order = reranked.order;
      reranked.drop.forEach((d) => dropSet.add(d));
    } catch (e) {
      console.error('RAG rerank error:', e);
      order = rerankMatches.map((_, i) => i);
    }
  }

  const filteredOrder = order.filter((i) => !dropSet.has(i));
  let effectiveOrder =
    filteredOrder.length > 0 ? filteredOrder : order;

  effectiveOrder = reorderForPhraseAnchor(
    effectiveOrder,
    rerankMatches,
    phraseChunkIds,
    phraseCandidates
  );

  const postSessionVectorConsensus = dominantVectorDocKey(
    vectorMatches,
    rowDocKey,
    10,
    3
  );
  effectiveOrder = reorderForTitleKeywordAnchor(
    effectiveOrder,
    rerankMatches,
    titleKeywordChunkIds,
    titleKeywordRows,
    userQuery,
    postSessionVectorConsensus,
    routedDocKeys
  );

  let primaryKey = primaryDocKeyFromRerankOrder(effectiveOrder, rerankMatches);

  if (retrievalMode === 'explicit_session' && primaryKey) {
    primaryKey = correctExplicitSessionPrimaryDocKey(
      primaryKey,
      userQuery,
      rerankMatches,
      vectorMatches,
      titleKeywordRows,
      rowDocKey,
      rowTitle
    );
  }

  if (sessionRoute && shouldLockPrimaryToRoute(sessionRoute) && routedDocKeys[0]) {
    const lockKey = routedDocKeys[0];
    if (rerankMatches.some((m) => rowDocKey(m) === lockKey)) {
      primaryKey = lockKey;
    }
  } else if (primaryKey) {
    const corrected = correctMisroutedPrimaryDocKey(
      primaryKey,
      userQuery,
      rerankMatches,
      vectorMatches,
      rowDocKey,
      rowTitle,
      sessionRoute
    );
    if (
      corrected !== primaryKey &&
      rerankMatches.some((m) => rowDocKey(m) === corrected)
    ) {
      primaryKey = corrected;
    }
  }

  if (primaryKey) {
    const primaryFirst: number[] = [];
    const rest: number[] = [];
    for (const idx of effectiveOrder) {
      if (rowDocKey(rerankMatches[idx]!) === primaryKey) {
        primaryFirst.push(idx);
      } else {
        rest.push(idx);
      }
    }
    if (primaryFirst.length > 0) {
      effectiveOrder = [...primaryFirst, ...rest];
    }
  }

    let pick: MatchRow[];

    if (singleSource && effectiveOrder.length > 0) {
      pick = [];
      for (const idx of effectiveOrder) {
        if (pick.length >= Math.max(1, maxChunks)) break;
        const row = rerankMatches[idx];
        if (rowDocKey(row) === primaryKey) pick.push(row);
      }
      if (pick.length === 0) pick = [rerankMatches[effectiveOrder[0]]!];
    } else {
      pick = selectChunksFromRerank(
        effectiveOrder,
        rerankMatches,
        effectiveMaxDocs,
        Math.max(maxChunks, effectiveMaxDocs)
      );
    }

    pick = ensureComparisonDocsInPick(
      pick,
      effectiveOrder,
      rerankMatches,
      userQuery,
      Math.max(maxChunks, effectiveMaxDocs),
      rowTitle
    );

    pick = orderPickPrimaryFirst(pick, primaryKey ?? '');

    if (
      sessionRoute &&
      shouldLockPrimaryToRoute(sessionRoute) &&
      primaryKey
    ) {
      pick = ensureRoutedVideoChunksInPick(
        pick,
        poolForChunks,
        primaryKey,
        phraseChunkIds,
        Math.max(maxChunks, effectiveMaxDocs),
        rowTitle
      );
    }

    if (
      primaryKey &&
      pick.length > 0 &&
      !pick.some((m) => rowDocKey(m) === primaryKey)
    ) {
      primaryKey = rowDocKey(pick[0]!);
    }

    let citationDocKeys = resolveCitationDocKeys(
      pick,
      primaryKey,
      effectiveMaxKbLinks,
      intentParams.intent
    );

    if (intentParams.intent === 'factual' && primaryKey) {
      citationDocKeys = new Set([primaryKey]);
    }

    if (
      primaryKey &&
      shouldSingleCitationForMeetingRhythm(
        userQuery,
        primaryKey,
        rerankMatches,
        rowDocKey,
        rowTitle,
        sessionRoute
      )
    ) {
      citationDocKeys = new Set([primaryKey]);
    }

    const sources: RagSource[] = [];
    const linkedDocKeys = new Set<string>();
    const contextParts: string[] = [];

    for (const row of pick) {
      const title = rowTitle(row);
      const docKey = rowDocKey(row);

      if (
        citationDocKeys.has(docKey) &&
        !linkedDocKeys.has(docKey) &&
        sources.length < effectiveMaxKbLinks
      ) {
        linkedDocKeys.add(docKey);
        sources.push(ragSourceFromRow(row, title));
      }

      contextParts.push(`---\nSource: ${title}\n${row.content.trim()}`);
    }

    const primarySourceTitle = primaryKey
      ? (() => {
          const row = pick.find((m) => rowDocKey(m) === primaryKey);
          return row ? rowTitle(row) : null;
        })()
      : pick.length > 0
        ? rowTitle(pick[0]!)
        : null;

    const result: StorageRagResult = {
      contextBlock: contextParts.join('\n\n'),
      sources,
      primarySourceTitle,
      queryIntent: intentParams.intent,
      answerGuidance: intentParams.answerGuidance,
    };

    const debug: RagPipelineDebug = collectDebug
      ? {
          vectorCount: vectorMatches.length,
          titleKeywordCount: titleKeywordRows.length,
          phraseCount: phraseRows.length,
          ftsCount: ftsRows.length,
          primaryTitle: (() => {
            const row = rerankMatches.find((m) => rowDocKey(m) === primaryKey);
            return row ? rowTitle(row) : null;
          })(),
          pickTitles: pick.map(rowTitle),
          citationTitles: sources.map((s) => s.title),
          topVectorTitles: vectorMatches.slice(0, 5).map(rowTitle),
          llmRewriteUsed: Boolean(llmOnlyRewrite),
          llmSearchQueries: rewrite?.keywordExpansions ?? [],
          vectorQueryCount: embeddings.length,
          sessionAgreementDocs: sessionAgreementDocs.map((k) => {
            const row = vectorMatches.find((m) => rowDocKey(m) === k);
            return row ? rowTitle(row) : k;
          }),
          routedTopicId: sessionRoute?.topicId ?? null,
          routedLabel: sessionRoute?.label ?? null,
          routedConfidence: sessionRoute?.confidence ?? null,
          routedDocKeys: routedDocKeys.map((k) => {
            const row =
              rerankMatches.find((m) => rowDocKey(m) === k) ??
              vectorMatches.find((m) => rowDocKey(m) === k);
            return row ? rowTitle(row) : k;
          }),
          rewriteScore: rewriteMeta.gate.score,
          rewriteMode: rewriteMeta.mode,
          rewriteSignals: rewriteMeta.gate.signals,
          topicHintUsed: rewriteMeta.topicHintUsed,
          retrievalMode,
          intentRouterIntents: intentRoute.intents,
          intentRouterConfidence: intentRoute.confidence,
          intentRouterSource: intentRoute.source,
          docPoolKeys: docPoolResult
            ? [...docPoolResult.allowedDocKeys].map((k) => {
                const row =
                  matches.find((m) => rowDocKey(m) === k) ??
                  vectorMatches.find((m) => rowDocKey(m) === k);
                return row ? rowTitle(row) : k;
              })
            : [],
          docPoolSource: docPoolResult?.source ?? null,
        }
      : emptyDebug;

    return { result, debug };
  } catch (e) {
    console.error('retrieveStorageRag:', e);
    return { result: null, debug: emptyDebug };
  }
}

export function ragContextSystemAppendix(
  contextBlock: string,
  primarySourceTitle?: string | null,
  queryIntent?: RagQueryIntent | null,
  answerGuidance?: string
): string {
  const authority = primarySourceTitle
    ? `PRIMARY SOURCE (main Knowledge base link): ${primarySourceTitle}`
    : 'The first Source block below is the primary authority.';

  const intentNote = queryIntent
    ? `Question type for this reply: ${queryIntent}.`
    : '';

  const style = answerGuidance ?? 'Answer using only the excerpts below.';

  return `

INTERNAL KNOWLEDGE BASE (TiB PDFs and video transcripts — evidence for this reply):

${contextBlock}

KNOWLEDGE BASE RULES (required):
- ${authority}
- ${intentNote}
- ${style}
- Use logical reasoning when the user asks why/how/what-if, but every conclusion must follow from the excerpts — do not invent facts, quotes, or sessions.
- Do NOT say you lack access, need different excerpts, or that the opening/session content is unavailable when Source blocks are present — answer from those excerpts only.
- Do NOT name a different TiB document than the primary source unless comparison mode or the user asked for multiple sources.
- Name sources you use in plain language in "answer" (no URLs).
- "next_steps": 2–4 when practical; omit or shorten for pure factual lookups.
- "tasks": [] for simple factual lookups only; when the user shares a goal or asks how to fix/improve their business, include exactly 3 physical immediate tasks (easiest first) in the JSON "tasks" array — same rules as your main system prompt.
- If excerpts cannot answer, say so briefly; do not fabricate TiB content.

Keep the usual JSON shape; Knowledge base links are attached separately.`;
}
