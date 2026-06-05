import type { MatchRow } from '@/lib/ai/rag-merge';
import type { PhraseChunkRow } from '@/lib/ai/rag-phrase-search';

const MONTH =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/** User named a specific TiB session in the question (common coach + random-test templates). */
export function extractExplicitSessionTitle(userQuery: string): string | null {
  const q = userQuery.replace(/\s+/g, ' ').trim();
  const patterns = [
    /what does the tib session\s+"([^"]{6,160})"/i,
    /according to\s+([^,]{6,160}),\s+what/i,
    /in\s+([^,]{6,160}),\s+they mentioned/i,
    /how does\s+(.+?)\s+recommend\s+handling/i,
    /summarise the practical advice from\s+(.+?)\s+on\s/i,
    /i'm a tradie\s*[—–-]\s*how does\s+(.+?)\s+recommend/i,
  ];
  for (const re of patterns) {
    const m = q.match(re);
    if (!m?.[1]) continue;
    const title = m[1].trim().replace(/\s+on\s*$/i, '');
    if (title.length >= 8) return title;
  }
  return null;
}

function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** e.g. "25 june 2025" or "april 29" for disambiguating Momentum Meet files. */
function meetDateSignature(label: string): string | null {
  const n = normalizeLabel(label);
  const m1 = n.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH})(?:\\s+(\\d{4}))?\\b`, 'i'));
  if (m1) {
    return `${m1[1]} ${m1[2]}${m1[3] ? ` ${m1[3]}` : ''}`.toLowerCase();
  }
  const m2 = n.match(new RegExp(`\\b(${MONTH})\\s+(\\d{1,2})\\b`, 'i'));
  if (m2) return `${m2[2]} ${m2[1]}`.toLowerCase();
  const m3 = n.match(/\b(recording\s+)?(\d{10,12})\b/);
  if (m3) return `id:${m3[2]}`;
  return null;
}

function significantParts(anchor: string): string[] {
  const stop = new Set([
    'the',
    'a',
    'an',
    'with',
    'for',
    'and',
    'your',
    'from',
    'session',
    'expert',
    'meet',
    'meeting',
    'done',
    'you',
  ]);
  return normalizeLabel(anchor)
    .split(' ')
    .filter((w) => w.length >= 3 && !stop.has(w));
}

/** 0–100 — how well a chunk title matches the session the user named. */
export function sessionTitleMatchScore(anchor: string, title: string): number {
  const a = normalizeLabel(anchor);
  const t = normalizeLabel(title);
  if (!a || !t) return 0;
  if (t.includes(a) || a.includes(t)) return 100;

  const parts = significantParts(anchor);
  if (parts.length === 0) return 0;

  let hit = 0;
  for (const p of parts) {
    if (t.includes(p)) hit++;
  }
  let score = (hit / parts.length) * 85;

  if (/momentum meet/i.test(a) && /momentum meet/i.test(t)) {
    const aDate = meetDateSignature(a);
    const tDate = meetDateSignature(t);
    if (aDate && tDate) {
      if (aDate === tDate) score = Math.min(100, score + 25);
      else score = Math.min(score, 25);
    }
  }

  if (/expert session with/i.test(a) && /expert session with/i.test(t)) {
    const aName = a.replace(/.*expert session with\s+/, '').trim();
    if (aName.length >= 4 && t.includes(aName)) score = Math.min(100, score + 20);
  }

  return Math.round(score);
}

export function findDocKeyForExplicitSession(
  anchor: string,
  rows: MatchRow[],
  rowDocKey: (row: MatchRow) => string,
  rowTitle: (row: MatchRow) => string,
  minScore = 52
): string | null {
  const byKey = new Map<string, { score: number; title: string }>();

  for (const row of rows) {
    const key = rowDocKey(row);
    const title = rowTitle(row);
    const score = sessionTitleMatchScore(anchor, title);
    const prev = byKey.get(key);
    if (!prev || score > prev.score) {
      byKey.set(key, { score, title });
    }
  }

  let bestKey: string | null = null;
  let bestScore = 0;
  for (const [key, { score }] of byKey) {
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  return bestScore >= minScore ? bestKey : null;
}

export function correctExplicitSessionPrimaryDocKey(
  primaryKey: string,
  userQuery: string,
  rerankMatches: MatchRow[],
  vectorMatches: MatchRow[],
  titleKeywordRows: PhraseChunkRow[],
  rowDocKey: (row: MatchRow) => string,
  rowTitle: (row: MatchRow) => string
): string {
  const anchor = extractExplicitSessionTitle(userQuery);
  if (!anchor) return primaryKey;

  const scan = [
    ...rerankMatches,
    ...vectorMatches.slice(0, 40),
    ...(titleKeywordRows as MatchRow[]).slice(0, 40),
  ];
  const forced = findDocKeyForExplicitSession(
    anchor,
    scan,
    rowDocKey,
    rowTitle
  );
  if (!forced) return primaryKey;

  const primaryRow = rerankMatches.find((m) => rowDocKey(m) === primaryKey);
  const primaryTitle = primaryRow ? rowTitle(primaryRow) : '';
  const primaryScore = primaryTitle
    ? sessionTitleMatchScore(anchor, primaryTitle)
    : 0;

  if (primaryScore >= 70) return primaryKey;
  return forced;
}
