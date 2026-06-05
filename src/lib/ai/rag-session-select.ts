import type { MatchRow } from '@/lib/ai/rag-merge';
import type { PhraseChunkRow } from '@/lib/ai/rag-phrase-search';
import { isSessionCardRow } from '@/lib/ai/session-card';
import { titleSearchTerms } from '@/lib/ai/rag-query-terms';

export type SessionSelectOpts = {
  userQuery: string;
  titleKeywordRows: PhraseChunkRow[];
  titleKeywordIds: Set<string>;
  phraseChunkIds: Set<string>;
  ftsChunkIds: Set<string>;
  rowDocKey: (row: MatchRow) => string;
};

/** Best score per document from merged retrieval signals. */
export function scoreSessionDocuments(
  matches: MatchRow[],
  opts: SessionSelectOpts
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const row of matches) {
    const key = opts.rowDocKey(row);
    let sim = typeof row.similarity === 'number' ? row.similarity : 0;
    if (isSessionCardRow(row.metadata)) sim += 0.42;
    scores.set(key, Math.max(scores.get(key) ?? 0, sim));
  }

  for (const row of matches) {
    const key = opts.rowDocKey(row);
    let s = scores.get(key) ?? 0;
    if (opts.titleKeywordIds.has(row.id)) s += 0.1;
    if (opts.phraseChunkIds.has(row.id)) s += 0.14;
    if (opts.ftsChunkIds.has(row.id)) s += 0.05;
    scores.set(key, s);
  }

  for (const row of opts.titleKeywordRows) {
    const key = opts.rowDocKey(row as MatchRow);
    scores.set(key, (scores.get(key) ?? 0) + 0.16);
  }

  const terms = titleSearchTerms(opts.userQuery, 8);
  const titleByDoc = new Map<string, string>();
  for (const row of matches) {
    titleByDoc.set(opts.rowDocKey(row), row.source_title.toLowerCase());
  }
  for (const row of opts.titleKeywordRows) {
    titleByDoc.set(
      opts.rowDocKey(row as MatchRow),
      row.source_title.toLowerCase()
    );
  }

  for (const [key, title] of titleByDoc) {
    let overlap = 0;
    for (const term of terms) {
      const t = term.toLowerCase();
      if (t.length < 4) continue;
      if (title.includes(t)) overlap += Math.min(t.length, 20);
    }
    if (overlap > 0) {
      scores.set(key, (scores.get(key) ?? 0) + Math.min(0.2, overlap * 0.008));
    }
  }

  return scores;
}

export function selectTopSessionDocKeys(
  scores: Map<string, number>,
  limit: number,
  forceInclude: string[] = []
): Set<string> {
  const out = new Set<string>();
  const cap = Math.max(1, limit);

  const uniqueForce = [...new Set(forceInclude.filter(Boolean))];
  const forceRanked = uniqueForce.sort(
    (a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0)
  );
  for (const k of forceRanked) {
    if (out.size >= cap) break;
    out.add(k);
  }

  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  for (const [key] of sorted) {
    if (out.size >= cap) break;
    out.add(key);
  }
  return out;
}

/** Up to `limit` document keys with the most title-keyword hits. */
export function topDocKeysByTitleKeywordHits(
  titleKeywordRows: PhraseChunkRow[],
  rowDocKey: (row: MatchRow) => string,
  limit: number
): string[] {
  const counts = new Map<string, number>();
  for (const row of titleKeywordRows) {
    const key = rowDocKey(row as MatchRow);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

export function filterMatchesToSessions(
  matches: MatchRow[],
  allowedDocKeys: Set<string>,
  rowDocKey: (row: MatchRow) => string
): MatchRow[] {
  if (allowedDocKeys.size === 0) return matches;
  return matches.filter((m) => allowedDocKeys.has(rowDocKey(m)));
}
