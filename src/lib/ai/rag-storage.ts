import type { RagSource } from '@/lib/types';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { embedQuery } from '@/lib/ai/openai-embed';
import { rerankPassagesWithOpenAI } from '@/lib/ai/rerank-openai';
import { fetchFtsMatches } from '@/lib/ai/rag-fts-search';
import {
  PHRASE_MATCH_SIMILARITY,
  mergeRetrievalCandidates,
  type MatchRow,
} from '@/lib/ai/rag-merge';
import {
  chunkContainsPhrase,
  fetchPhraseMatches,
  phraseSearchCandidates,
} from '@/lib/ai/rag-phrase-search';

const DEFAULT_MAX_SOURCE_PDFS = 3;
const DEFAULT_MAX_KB_LINKS = 3;
const DEFAULT_MATCH_THRESHOLD = 0.26;
const DEFAULT_VECTOR_MATCH_COUNT = 40;
const DEFAULT_CONTEXT_CHUNKS = 8;
/** Min best-chunk similarity to show any Knowledge base link */
const DEFAULT_MIN_SCORE_FOR_CITATION = 0.28;
/** Extra PDF link only if its best chunk meets this */
const DEFAULT_MIN_SCORE_FOR_EXTRA_CITATION = 0.31;
/**
 * Top PDF must lead the next by at least this much (similarity) to cite both.
 * Smaller gap = ambiguous (many similar playbooks) → cite only the #1 PDF.
 */
const DEFAULT_MIN_GAP_FOR_EXTRA_CITATION = 0.055;

function metaString(m: Record<string, unknown> | null, key: string): string | null {
  if (!m || typeof m[key] !== 'string') return null;
  const v = (m[key] as string).trim();
  return v || null;
}

function rowDocKey(row: MatchRow): string {
  const bucket =
    metaString(row.metadata, 'storage_bucket') ??
    process.env.RAG_STORAGE_BUCKET ??
    'Rag';
  const objectPath = metaString(row.metadata, 'storage_path');
  if (bucket && objectPath) return `${bucket}\0${objectPath}`;
  return `row:${row.id}`;
}

function rowTitle(row: MatchRow): string {
  const objectPath = metaString(row.metadata, 'storage_path');
  return (
    row.source_title ||
    objectPath?.split('/').pop()?.replace(/\.pdf$/i, '') ||
    'Knowledge base'
  );
}

/**
 * Build context chunks from reranked order: up to `maxDocs` distinct PDFs,
 * up to `maxChunks` total passages (fills from those PDFs only).
 */
function selectChunksFromRerank(
  order: number[],
  matches: MatchRow[],
  maxDocs: number,
  maxChunks: number
): MatchRow[] {
  const allowedDocs = new Set<string>();
  const pick: MatchRow[] = [];
  const pickIds = new Set<string>();

  const add = (row: MatchRow) => {
    if (pickIds.has(row.id)) return;
    pickIds.add(row.id);
    pick.push(row);
  };

  // Pass 1: best chunk per new document (rerank order) until maxDocs PDFs
  for (const idx of order) {
    if (allowedDocs.size >= maxDocs) break;
    const row = matches[idx];
    if (!row) continue;
    const key = rowDocKey(row);
    if (allowedDocs.has(key)) continue;
    allowedDocs.add(key);
    add(row);
  }

  // Pass 2: more chunks from those documents only
  for (const idx of order) {
    if (pick.length >= maxChunks) break;
    const row = matches[idx];
    if (!row) continue;
    if (!allowedDocs.has(rowDocKey(row))) continue;
    add(row);
  }

  if (pick.length === 0 && order.length > 0) {
    add(matches[order[0]]);
  }

  return pick;
}

type DocRank = { docKey: string; bestScore: number; rank: number };

/** Rerank order → ranked PDFs with each doc's strongest vector score. */
function rankDocumentsFromOrder(
  order: number[],
  matches: MatchRow[]
): DocRank[] {
  const byKey = new Map<string, DocRank>();
  let rank = 0;
  for (const idx of order) {
    const row = matches[idx];
    if (!row) continue;
    const docKey = rowDocKey(row);
    const sim = typeof row.similarity === 'number' ? row.similarity : 0;
    const existing = byKey.get(docKey);
    if (!existing) {
      byKey.set(docKey, { docKey, bestScore: sim, rank: rank++ });
    } else if (sim > existing.bestScore) {
      existing.bestScore = sim;
    }
  }
  return [...byKey.values()].sort((a, b) => a.rank - b.rank);
}

/**
 * Citation links (Knowledge base): up to maxLinks PDFs, gated so ambiguous
 * queries (many docs with similar scores) usually show only the top PDF.
 */
function selectCitationDocKeys(
  docRanks: DocRank[],
  maxLinks: number
): Set<string> {
  const out = new Set<string>();
  if (docRanks.length === 0 || maxLinks < 1) return out;

  const minAny = parseFloat(
    process.env.RAG_MIN_SCORE_FOR_CITATION ??
      String(DEFAULT_MIN_SCORE_FOR_CITATION)
  );
  const minExtra = parseFloat(
    process.env.RAG_MIN_SCORE_FOR_EXTRA_CITATION ??
      String(DEFAULT_MIN_SCORE_FOR_EXTRA_CITATION)
  );
  const minGap = parseFloat(
    process.env.RAG_MIN_GAP_FOR_EXTRA_CITATION ??
      String(DEFAULT_MIN_GAP_FOR_EXTRA_CITATION)
  );

  const top = docRanks[0];
  if (top.bestScore < minAny) return out;

  out.add(top.docKey);

  for (let i = 1; i < docRanks.length && out.size < maxLinks; i++) {
    const next = docRanks[i];
    const gap = top.bestScore - next.bestScore;
    // Too close in score → library is ambiguous; don't add weaker-looking extras
    if (gap < minGap) break;
    if (next.bestScore >= minExtra) {
      out.add(next.docKey);
    }
  }

  return out;
}

function pinLiteralMatchesFirst(
  order: number[],
  matches: MatchRow[],
  phraseChunkIds: Set<string>,
  ftsChunkIds: Set<string>
): number[] {
  const phraseIdx: number[] = [];
  const ftsIdx: number[] = [];
  const rest: number[] = [];
  for (const idx of order) {
    const id = matches[idx]?.id;
    if (phraseChunkIds.has(id)) phraseIdx.push(idx);
    else if (ftsChunkIds.has(id)) ftsIdx.push(idx);
    else rest.push(idx);
  }
  for (let i = 0; i < matches.length; i++) {
    const id = matches[i].id;
    if (phraseChunkIds.has(id) && !phraseIdx.includes(i)) phraseIdx.push(i);
    else if (ftsChunkIds.has(id) && !ftsIdx.includes(i)) ftsIdx.push(i);
  }
  return [...phraseIdx, ...ftsIdx, ...rest];
}

export type StorageRagResult = {
  contextBlock: string;
  sources: RagSource[];
};

export async function retrieveStorageRag(
  userQuery: string,
  openaiKey: string
): Promise<StorageRagResult | null> {
  try {
    return await retrieveStorageRagInner(userQuery, openaiKey);
  } catch (e) {
    console.error('retrieveStorageRag:', e);
    return null;
  }
}

async function retrieveStorageRagInner(
  userQuery: string,
  openaiKey: string
): Promise<StorageRagResult | null> {
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
      process.env.RAG_KNOWLEDGE_BASE_MAX_LINKS ??
      String(DEFAULT_MAX_SOURCE_PDFS),
    10
  );
  const maxDocs =
    Number.isFinite(maxDocsRaw) && maxDocsRaw >= 1
      ? Math.min(maxDocsRaw, 5)
      : DEFAULT_MAX_SOURCE_PDFS;

  const maxKbLinksRaw = parseInt(
    process.env.RAG_KNOWLEDGE_BASE_MAX_LINKS ?? String(DEFAULT_MAX_KB_LINKS),
    10
  );
  const maxKbLinks =
    Number.isFinite(maxKbLinksRaw) && maxKbLinksRaw >= 1
      ? Math.min(maxKbLinksRaw, 5)
      : DEFAULT_MAX_KB_LINKS;

  // Legacy: single-PDF mode overrides multi-doc selection
  const singleSource =
    (process.env.RAG_SINGLE_SOURCE_PDF ?? 'false').toLowerCase() === 'true';

  let embedding: number[];
  try {
    embedding = await embedQuery(userQuery, openaiKey);
  } catch (e) {
    console.error('RAG embed error:', e);
    return null;
  }

  const admin = createServiceRoleClient();
  const { data: rows, error } = await admin.rpc('match_knowledge_chunks', {
    query_embedding: embedding,
    match_threshold: Number.isFinite(threshold) ? threshold : DEFAULT_MATCH_THRESHOLD,
    match_count: Number.isFinite(vectorMatchCount)
      ? vectorMatchCount
      : DEFAULT_VECTOR_MATCH_COUNT,
  });

  if (error) {
    console.error('match_knowledge_chunks:', error);
  }

  const vectorMatches = error ? [] : ((rows || []) as MatchRow[]);

  const phraseCandidates = phraseSearchCandidates(userQuery);
  const phraseRows =
    phraseCandidates.length > 0
      ? await fetchPhraseMatches(admin, userQuery, 12)
      : [];
  const phraseIds = new Set(phraseRows.map((p) => p.id));

  const ftsLimit = parseInt(process.env.RAG_FTS_MATCH_COUNT ?? '15', 10) || 15;
  const {
    rows: ftsRows,
    ftsChunkIds: ftsHitIds,
    ranks: ftsRanks,
  } = await fetchFtsMatches(admin, userQuery, ftsLimit);

  const { matches, phraseChunkIds, ftsChunkIds } = mergeRetrievalCandidates(
    vectorMatches,
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

  if (matches.length === 0) return null;

  const passages = matches.map((m, i) => {
    let text = m.content;
    if (phraseChunkIds.has(m.id)) {
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
  try {
    const reranked = await rerankPassagesWithOpenAI(
      userQuery,
      passages,
      openaiKey
    );
    order = reranked.order;
    reranked.drop.forEach((d) => dropSet.add(d));
  } catch (e) {
    console.error('RAG rerank error:', e);
    order = matches.map((_, i) => i);
  }

  const filteredOrder = order.filter((i) => !dropSet.has(i));
  let effectiveOrder =
    filteredOrder.length > 0 ? filteredOrder : order;

  if (phraseChunkIds.size > 0 || ftsChunkIds.size > 0) {
    effectiveOrder = pinLiteralMatchesFirst(
      effectiveOrder,
      matches,
      phraseChunkIds,
      ftsChunkIds
    );
  }

  let pick: MatchRow[];

  if (singleSource && effectiveOrder.length > 0) {
    const anchorKey = rowDocKey(matches[effectiveOrder[0]]);
    pick = [];
    for (const idx of effectiveOrder) {
      if (pick.length >= Math.max(1, maxChunks)) break;
      const row = matches[idx];
      if (rowDocKey(row) === anchorKey) pick.push(row);
    }
    if (pick.length === 0) pick = [matches[effectiveOrder[0]]];
  } else {
    pick = selectChunksFromRerank(
      effectiveOrder,
      matches,
      maxDocs,
      Math.max(maxChunks, maxDocs)
    );
  }

  const docRanks = rankDocumentsFromOrder(effectiveOrder, matches);
  let citationDocKeys = selectCitationDocKeys(docRanks, maxKbLinks);

  // Exact phrase in chunk text → cite only PDF(s) that contain that phrase
  if (phraseChunkIds.size > 0 && phraseCandidates.length > 0) {
    const phraseDocKeys = new Set<string>();
    for (const row of matches) {
      if (
        phraseChunkIds.has(row.id) &&
        chunkContainsPhrase(row.content, phraseCandidates)
      ) {
        phraseDocKeys.add(rowDocKey(row));
      }
    }
    if (phraseDocKeys.size > 0) {
      citationDocKeys = phraseDocKeys;
    }
  }

  const sources: RagSource[] = [];
  const linkedDocKeys = new Set<string>();
  const contextParts: string[] = [];

  for (const row of pick) {
    const bucket =
      metaString(row.metadata, 'storage_bucket') ??
      process.env.RAG_STORAGE_BUCKET ??
      'Rag';
    const objectPath = metaString(row.metadata, 'storage_path');
    const title = rowTitle(row);
    const docKey = rowDocKey(row);

    if (
      citationDocKeys.has(docKey) &&
      !linkedDocKeys.has(docKey) &&
      sources.length < maxKbLinks
    ) {
      linkedDocKeys.add(docKey);
      const proxyHref = `/api/rag/pdf?chunk_id=${encodeURIComponent(row.id)}`;
      sources.push({
        chunk_id: row.id,
        title,
        pdf_url: proxyHref,
        page_url: proxyHref,
        storage_bucket: bucket,
        storage_path: objectPath,
      });
    }

    contextParts.push(`---\nSource: ${title}\n${row.content.trim()}`);
  }

  return {
    contextBlock: contextParts.join('\n\n'),
    sources,
  };
}

export function ragContextSystemAppendix(contextBlock: string): string {
  return `

INTERNAL KNOWLEDGE BASE (PDF excerpts from TiB materials — use when they genuinely help the answer; do not invent facts not supported here or by general coaching knowledge):

${contextBlock}

When you lean on these excerpts, keep the same JSON response shape as usual; do not paste raw URLs in "answer" — the app attaches source links separately.
If passages are marked EXACT PHRASE MATCH, that source is the primary PDF for the user's quote; align next_steps with that document's Source title.`;
}
