import type { MatchRow } from '@/lib/ai/rag-merge';

/**
 * Cap how many chunks from one document enter rerank (stops mega-sessions flooding the pool).
 */
export function diversifyMatchesByDoc(
  matches: MatchRow[],
  maxPerDoc: number,
  docKeyFn: (row: MatchRow) => string
): MatchRow[] {
  if (maxPerDoc < 1 || matches.length === 0) return matches;

  const sorted = [...matches].sort((a, b) => b.similarity - a.similarity);
  const perDoc = new Map<string, MatchRow[]>();

  for (const row of sorted) {
    const key = docKeyFn(row);
    const list = perDoc.get(key) ?? [];
    if (list.length < maxPerDoc) {
      list.push(row);
      perDoc.set(key, list);
    }
  }

  const docOrder = [...perDoc.entries()]
    .sort((a, b) => (b[1][0]?.similarity ?? 0) - (a[1][0]?.similarity ?? 0))
    .map(([, rows]) => rows);

  const out: MatchRow[] = [];
  let round = 0;
  for (;;) {
    let added = false;
    for (const rows of docOrder) {
      if (round < rows.length) {
        out.push(rows[round]!);
        added = true;
      }
    }
    if (!added) break;
    round++;
  }

  return out.length > 0 ? out : sorted;
}
