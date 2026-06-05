import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchRow } from '@/lib/ai/rag-merge';

export type MergedVectorResult = {
  merged: MatchRow[];
  perQuery: MatchRow[][];
};

export async function fetchMergedVectorMatches(
  admin: SupabaseClient,
  embeddings: number[][],
  threshold: number,
  matchCount: number
): Promise<MergedVectorResult> {
  const byId = new Map<string, MatchRow>();
  const perQuery: MatchRow[][] = [];

  for (const query_embedding of embeddings) {
    const { data, error } = await admin.rpc('match_knowledge_chunks', {
      query_embedding,
      match_threshold: threshold,
      match_count: matchCount,
    });

    if (error) {
      console.error('match_knowledge_chunks:', error);
      perQuery.push([]);
      continue;
    }

    const rows = (data || []) as MatchRow[];
    perQuery.push(rows);

    for (const row of rows) {
      const prev = byId.get(row.id);
      const sim = typeof row.similarity === 'number' ? row.similarity : 0;
      const prevSim =
        prev && typeof prev.similarity === 'number' ? prev.similarity : 0;
      if (!prev || sim > prevSim) byId.set(row.id, row);
    }
  }

  const merged = [...byId.values()]
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, matchCount);

  return { merged, perQuery };
}

/** Documents in top-N for multiple rewrite queries get forced into session-first pool. */
export function sessionAgreementDocKeys(
  perQueryMatches: MatchRow[][],
  rowDocKey: (row: MatchRow) => string,
  topNPerQuery = 5,
  minVotes = 2
): string[] {
  if (perQueryMatches.length < 2) return [];

  const votes = new Map<string, number>();

  for (const matches of perQueryMatches) {
    const docBest = new Map<string, number>();
    for (const row of matches) {
      const key = rowDocKey(row);
      const sim = typeof row.similarity === 'number' ? row.similarity : 0;
      docBest.set(key, Math.max(docBest.get(key) ?? 0, sim));
    }
    const top = [...docBest.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topNPerQuery);
    for (const [key] of top) {
      votes.set(key, (votes.get(key) ?? 0) + 1);
    }
  }

  return [...votes.entries()]
    .filter(([, v]) => v >= minVotes)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}

/** Document that owns most of the top vector hits (rewrite / multi-query agreement). */
export function dominantVectorDocKey(
  vectorMatches: MatchRow[],
  rowDocKey: (row: MatchRow) => string,
  topN = 10,
  minCount = 3
): string | null {
  const counts = new Map<string, number>();
  for (const row of vectorMatches.slice(0, topN)) {
    const k = rowDocKey(row);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  if (!top || top[1] < minCount) return null;
  return top[0];
}
