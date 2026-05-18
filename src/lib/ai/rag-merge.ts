import type { PhraseChunkRow } from '@/lib/ai/rag-phrase-search';
import { PHRASE_MATCH_SIMILARITY } from '@/lib/ai/rag-phrase-search';
import { ftsRankToSimilarity } from '@/lib/ai/rag-fts-search';

export type MatchRow = {
  id: string;
  content: string;
  source_title: string;
  source_url: string | null;
  resource_url: string | null;
  metadata: Record<string, unknown> | null;
  similarity: number;
};

type LiteralHit = {
  rows: PhraseChunkRow[];
  similarity: number;
  ids: Set<string>;
};

/**
 * Merge vector + phrase (ILIKE) + FTS hits.
 * Order: phrase → FTS → vector (by similarity).
 */
export function mergeRetrievalCandidates(
  vectorRows: MatchRow[],
  phrase: LiteralHit,
  fts: LiteralHit & { ranks: Map<string, number> }
): {
  matches: MatchRow[];
  phraseChunkIds: Set<string>;
  ftsChunkIds: Set<string>;
} {
  const byId = new Map<string, MatchRow>();

  const applyLiteral = (rows: PhraseChunkRow[], sim: number) => {
    for (const p of rows) {
      const existing = byId.get(p.id);
      if (existing) {
        existing.similarity = Math.max(existing.similarity, sim);
      } else {
        byId.set(p.id, { ...p, similarity: sim });
      }
    }
  };

  for (const v of vectorRows) {
    const existing = byId.get(v.id);
    if (existing) {
      existing.similarity = Math.max(existing.similarity, v.similarity);
    } else {
      byId.set(v.id, v);
    }
  }

  applyLiteral(phrase.rows, phrase.similarity);
  for (const p of fts.rows) {
    const rank = fts.ranks.get(p.id) ?? 0;
    applyLiteral([p], ftsRankToSimilarity(rank));
  }

  const phraseFirst = phrase.rows
    .map((p) => byId.get(p.id))
    .filter((r): r is MatchRow => !!r);

  const ftsFirst = fts.rows
    .filter((p) => !phrase.ids.has(p.id))
    .map((p) => byId.get(p.id))
    .filter((r): r is MatchRow => !!r);

  const used = new Set([...phrase.ids, ...fts.ids]);
  const rest = [...byId.values()]
    .filter((r) => !used.has(r.id))
    .sort((a, b) => b.similarity - a.similarity);

  return {
    matches: [...phraseFirst, ...ftsFirst, ...rest],
    phraseChunkIds: phrase.ids,
    ftsChunkIds: fts.ids,
  };
}

export { PHRASE_MATCH_SIMILARITY };
