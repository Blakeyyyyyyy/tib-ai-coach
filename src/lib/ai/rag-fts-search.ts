import type { SupabaseClient } from '@supabase/supabase-js';
import type { PhraseChunkRow } from '@/lib/ai/rag-phrase-search';

/** Map Postgres ts_rank (typically 0–1) into vector-like scores for merging. */
export const FTS_MATCH_SIMILARITY_BASE = 0.9;

export function ftsQueryEligible(userQuery: string): boolean {
  const q = userQuery.replace(/\s+/g, ' ').trim();
  if (q.length < 8) return false;
  const words = q.split(' ').filter(Boolean);
  return words.length >= 2;
}

export function ftsRankToSimilarity(rank: number): number {
  if (!Number.isFinite(rank) || rank <= 0) return FTS_MATCH_SIMILARITY_BASE;
  return Math.min(0.97, FTS_MATCH_SIMILARITY_BASE + rank * 0.12);
}

/**
 * Postgres full-text search on title + content (GIN index).
 * Good for keywords and short questions; complements vectors and ILIKE phrases.
 */
export async function fetchFtsMatches(
  admin: SupabaseClient,
  userQuery: string,
  limit = 15
): Promise<{
  rows: PhraseChunkRow[];
  ftsChunkIds: Set<string>;
  ranks: Map<string, number>;
}> {
  const ftsChunkIds = new Set<string>();
  const ranks = new Map<string, number>();
  if (!ftsQueryEligible(userQuery)) {
    return { rows: [], ftsChunkIds, ranks };
  }

  const { data, error } = await admin.rpc('search_knowledge_chunks_fts', {
    search_query: userQuery.trim().slice(0, 2000),
    match_count: limit,
  });

  if (error) {
    console.error('search_knowledge_chunks_fts:', error.message);
    return { rows: [], ftsChunkIds, ranks };
  }

  const rows: PhraseChunkRow[] = [];
  for (const row of data || []) {
    if (!row?.id) continue;
    ftsChunkIds.add(row.id);
    const r = typeof row.rank === 'number' ? row.rank : 0;
    ranks.set(row.id, r);
    rows.push({
      id: row.id,
      content: row.content,
      source_title: row.source_title,
      source_url: row.source_url,
      resource_url: row.resource_url,
      metadata: row.metadata as Record<string, unknown> | null,
    });
  }

  return { rows, ftsChunkIds, ranks };
}
