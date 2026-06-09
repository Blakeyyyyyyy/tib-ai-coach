import { extractExplicitSessionTitle } from '@/lib/ai/rag-explicit-session';

/** Common English stopwords — excluded from keyword/title retrieval. */
export const QUERY_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'as',
  'by',
  'with',
  'from',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'must',
  'can',
  'what',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'why',
  'how',
  'that',
  'this',
  'these',
  'those',
  'it',
  'its',
  'i',
  'me',
  'my',
  'we',
  'our',
  'you',
  'your',
  'they',
  'their',
  'them',
  'he',
  'she',
  'his',
  'her',
  'about',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'under',
  'over',
  'again',
  'further',
  'then',
  'once',
  'here',
  'there',
  'all',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'just',
  'also',
  'even',
  'based',
  'according',
  'tell',
  'explain',
  'describe',
  'give',
  'know',
  'think',
  'want',
  'need',
  'like',
  'make',
  'use',
  'using',
  'asked',
  'question',
  'answer',
]);

function normalizeQueryText(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(query: string): string[] {
  return normalizeQueryText(query)
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

/**
 * Salient terms for title/keyword retrieval (longer & rarer words first).
 */
export function salientQueryTerms(userQuery: string, maxTerms = 6): string[] {
  const q = normalizeQueryText(userQuery);
  const found = new Map<string, number>();

  const possessive = q.match(/\b([A-Za-z]{2,28})'s\b/g);
  for (const m of possessive ?? []) {
    const name = m.replace(/'s$/i, '').trim();
    if (name.length >= 3) {
      found.set(name, (found.get(name) ?? 0) + 10);
    }
  }

  const quoted = [...q.matchAll(/"([^"]{3,80})"|'([^']{3,80})'/g)];
  for (const m of quoted) {
    const phrase = (m[1] ?? m[2] ?? '').trim();
    if (phrase.length >= 3) found.set(phrase, (found.get(phrase) ?? 0) + 12);
  }

  const multiCapital = q.match(
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g
  );
  for (const m of multiCapital ?? []) {
    found.set(m, (found.get(m) ?? 0) + 8);
  }

  for (const raw of tokenize(q)) {
    if (QUERY_STOPWORDS.has(raw)) continue;
    if (raw.length < 3) continue;
    const score = raw.length + (/[0-9]/.test(raw) ? 2 : 0);
    const prev = found.get(raw) ?? 0;
    if (score > prev) found.set(raw, score);
  }

  return [...found.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([term]) => term)
    .slice(0, maxTerms);
}

/** Single-word title terms that match too many sessions — skip for title-only search. */
const GENERIC_TITLE_TERMS = new Set([
  'financial',
  'business',
  'marketing',
  'money',
  'sales',
  'team',
  'client',
  'quote',
  'job',
  'work',
  'help',
  'systems',
  'system',
  'pricing',
  'price',
  'project',
  'projects',
  'losing',
  'fix',
  'margin',
  'margins',
  'trade',
]);

/**
 * High-signal phrases (include stopwords) for literal content search.
 */
export function signalPhrasesFromQuery(userQuery: string): string[] {
  const normalized = normalizeQueryText(userQuery);
  const out = new Set<string>();

  const quoted = [
    ...normalized.matchAll(
      /"([^"]{4,200})"|'([^']{4,200})'|[\u2018]([^\u2019]{4,200})[\u2019]/g
    ),
  ];
  for (const m of quoted) {
    const p = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (p.length >= 4) out.add(p);
  }

  if (
    /\b(july|1\s*july|beginning of july)\b/i.test(normalized) &&
    /\b(optimistic|hopeful|struggle)\b/i.test(normalized)
  ) {
    out.add('most hopeful time of the year');
  }

  const patterns = [
    /\bmost hopeful(?:\s+time)?\b/gi,
    /\bhopeful time\b/gi,
    /\bmasogi\b/gi,
    /\bfooty season\b/gi,
    /\bfinancial jam\b/gi,
    /\btwo drunk accountants\b/gi,
    /\bnew financial year\b/gi,
    /\bstart of (?:a )?new financial year\b/gi,
    /\beofy\b/gi,
    /\bget ready for eofy\b/gi,
    /\bwebsite traffic\b/gi,
    /\bphone never rings\b/gi,
    /\bwebsite visits\b/gi,
    /\bno calls\b/gi,
    /\bsystemology\b/gi,
    /\bdocumenting systems\b/gi,
    /\binternal fit outs?\b/gi,
    /\bpaid quotes\b/gi,
    /\bcharge for quotes\b/gi,
    /\bsay no\b/gi,
    /\bcrappy jobs\b/gi,
    /\bcash vs accrual\b/gi,
    /\bhire.{0,20}apprentice\b/gi,
    /\bscreening questions\b/gi,
    /\blosing money\b/gi,
    /\blosing on (?:jobs|projects)\b/gi,
    /\bfix pricing\b/gi,
    /\bjob (?:margin|profit)\b/gi,
    /\bhourly rate\b/gi,
    /\bbackcost(?:ing)?\b/gi,
    /\bfive profit levers\b/gi,
    /\bwhere to start\b.*\bsystems\b/gi,
    /\b(?:what|which) systems\b.*\bfirst\b/gi,
    /\bcritical alignment model\b/gi,
    /\bcritical alignment\b/gi,
    /\bmeaningful connections\b/gi,
  ];
  for (const re of patterns) {
    for (const m of normalized.matchAll(re)) {
      out.add(m[0].trim());
    }
  }

  return [...out];
}

/**
 * Multi-word terms safe for source_title search (avoids "financial" alone).
 */
export function titleSearchTerms(userQuery: string, maxTerms = 6): string[] {
  const signals = signalPhrasesFromQuery(userQuery);
  const out = new Set<string>();
  for (const p of signals) {
    if (p.length >= 5) out.add(p);
  }
  for (const t of salientQueryTerms(userQuery, maxTerms + 4)) {
    if (GENERIC_TITLE_TERMS.has(t.toLowerCase())) continue;
    out.add(t);
  }
  return [...out].slice(0, maxTerms);
}

/**
 * Short phrases for literal content search (2–4 word windows + full stripped query).
 */
export function salientPhraseCandidates(
  userQuery: string,
  maxPhrases = 8
): string[] {
  const normalized = normalizeQueryText(userQuery);
  const stripped = normalized.replace(/^["']+|["']+$/g, '').trim();
  const out = new Set<string>();

  for (const p of signalPhrasesFromQuery(userQuery)) {
    out.add(p);
  }

  const quoted = [...normalized.matchAll(/"([^"]{8,200})"|'([^']{8,200})'/g)];
  for (const m of quoted) {
    const p = (m[1] ?? m[2] ?? '').trim();
    if (p.length >= 8) out.add(p);
  }

  const words = tokenize(stripped).filter((w) => !QUERY_STOPWORDS.has(w));
  for (let n = 4; n >= 2; n--) {
    for (let i = 0; i <= words.length - n; i++) {
      const phrase = words.slice(i, i + n).join(' ');
      if (phrase.length >= 8) out.add(phrase);
    }
  }

  if (stripped.length >= 10 && stripped.length <= 120) {
    out.add(stripped);
    if (stripped.includes("'")) {
      out.add(stripped.replace(/'/g, '\u2019'));
    }
  }

  return [...out]
    .sort((a, b) => b.length - a.length)
    .slice(0, maxPhrases);
}

/** True when the question names a person, brand, or session (possessive / Title Case). */
export function hasEntityStyleTerms(userQuery: string): boolean {
  return entityAnchorTerms(userQuery).length > 0;
}

/**
 * Names/brands/sessions only — used to anchor citations (not generic words like "marketing").
 */
export function entityAnchorTerms(userQuery: string): string[] {
  const explicit = extractExplicitSessionTitle(userQuery);
  if (explicit) {
    return [explicit];
  }

  const q = normalizeQueryText(userQuery);
  const found = new Map<string, number>();

  for (const m of q.match(/\b([A-Za-z]{2,28})'s\b/g) ?? []) {
    const name = m.replace(/'s$/i, '').trim();
    if (name.length >= 3) found.set(name, (found.get(name) ?? 0) + 20);
  }

  for (const m of q.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g) ?? []) {
    if (!QUERY_STOPWORDS.has(m.toLowerCase())) {
      found.set(m, (found.get(m) ?? 0) + 15);
    }
  }

  for (const m of q.match(/\b[A-Z][a-z]{2,24}\b/g) ?? []) {
    if (!QUERY_STOPWORDS.has(m.toLowerCase())) {
      found.set(m, (found.get(m) ?? 0) + 8);
    }
  }

  return [...found.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t)
    .slice(0, 4);
}
