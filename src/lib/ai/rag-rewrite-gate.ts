import { extractExplicitSessionTitle } from '@/lib/ai/rag-explicit-session';
import {
  hasEntityStyleTerms,
  signalPhrasesFromQuery,
} from '@/lib/ai/rag-query-terms';
import { scoreTopicsForQuery } from '@/lib/ai/rag-topic-catalog';

export type RewriteMode = 'off' | 'soft' | 'full';

export type RewriteGateResult = {
  score: number;
  mode: RewriteMode;
  signals: string[];
};

const DEFAULT_SOFT = 0.5;
const DEFAULT_FULL = 1.0;

function softThreshold(): number {
  const n = parseFloat(process.env.RAG_REWRITE_SOFT_THRESHOLD ?? String(DEFAULT_SOFT));
  return Number.isFinite(n) ? n : DEFAULT_SOFT;
}

function fullThreshold(): number {
  const n = parseFloat(process.env.RAG_REWRITE_FULL_THRESHOLD ?? String(DEFAULT_FULL));
  return Number.isFinite(n) ? n : DEFAULT_FULL;
}

export function isVagueUserQuery(userQuery: string): boolean {
  const q = userQuery.replace(/\s+/g, ' ').trim();
  const lower = q.toLowerCase();
  const words = q.split(/\s+/).filter(Boolean).length;

  if (
    words <= 8 &&
    /\b(what next|what should i do next|any tips|your thoughts|go on|continue|what about that|and what about)\b/i.test(
      lower
    )
  ) {
    return true;
  }
  if (
    words < 12 &&
    /\b(what next|what should i|any tips|thoughts on that|help me with that)\b/i.test(
      lower
    )
  ) {
    return true;
  }
  if (words <= 5 && !hasEntityStyleTerms(q) && !extractExplicitSessionTitle(q)) {
    return true;
  }
  return false;
}

function hasExactSessionMatch(userQuery: string): boolean {
  if (extractExplicitSessionTitle(userQuery)) return true;
  if (/what does the tib session\s+"/i.test(userQuery)) return true;
  if (
    /\b(according to|summarise the practical advice from|i'm a tradie\s*[—–-]\s*how does)\s+[^,?]{8,140}/i.test(
      userQuery
    )
  ) {
    return true;
  }
  if (
    /\b(from|in)\s+(the\s+)?[\w\s]{4,48}\s+(session|meet|jam|podcast|webinar)\b/i.test(
      userQuery
    )
  ) {
    return true;
  }
  return false;
}

function isShortTechnicalQuery(userQuery: string): boolean {
  const words = userQuery.replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean)
    .length;
  if (words > 10) return false;
  if (signalPhrasesFromQuery(userQuery).length > 0) return true;
  const top = scoreTopicsForQuery(userQuery)[0];
  return (top?.score ?? 0) >= 0.45;
}

function isMissingEntities(userQuery: string): boolean {
  if (hasEntityStyleTerms(userQuery)) return false;
  if (extractExplicitSessionTitle(userQuery)) return false;
  return true;
}

export function scoreToRewriteMode(score: number): RewriteMode {
  if (score <= -0.5) return 'off';
  if (score >= fullThreshold()) return 'full';
  if (score >= softThreshold()) return 'soft';
  return 'off';
}

/** Tiered gate: off / soft / full LLM rewrite for retrieval. */
export function computeRewriteGate(userQuery: string): RewriteGateResult {
  const signals: string[] = [];
  let score = 0;

  if ((process.env.RAG_LLM_QUERY_REWRITE ?? 'true').toLowerCase() === 'false') {
    return { score: -2, mode: 'off', signals: ['rewrite_disabled'] };
  }

  if (isVagueUserQuery(userQuery)) {
    score += 1;
    signals.push('vague:+1');
  }
  if (isMissingEntities(userQuery)) {
    score += 0.5;
    signals.push('missing_entities:+0.5');
  }
  if (hasExactSessionMatch(userQuery)) {
    score -= 1;
    signals.push('exact_match:-1');
  }
  if (isShortTechnicalQuery(userQuery)) {
    score -= 0.5;
    signals.push('short_technical:-0.5');
  }

  let mode = scoreToRewriteMode(score);
  if (hasExactSessionMatch(userQuery)) {
    mode = 'off';
  }

  return { score, mode, signals };
}

/** One-line topic for vague retrieval rewrite only (not full chat history). */
export function buildRetrievalTopicHint(
  memorySummary: string | null | undefined,
  userQuery: string
): string | null {
  if ((process.env.CHAT_MEMORY_TOPIC_HINT_FOR_VAGUE ?? 'true').toLowerCase() === 'false') {
    return null;
  }
  if (!memorySummary?.trim()) return null;
  if (!isVagueUserQuery(userQuery)) return null;

  const lines = memorySummary
    .split(/\n/)
    .map((l) => l.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);

  const topicLine =
    lines.find((l) => /^current topic:/i.test(l)) ??
    lines.find((l) => /^(topic|focus):/i.test(l)) ??
    lines[0];

  if (!topicLine) return null;
  const cleaned = topicLine
    .replace(/^(current topic|topic|focus):\s*/i, '')
    .trim()
    .slice(0, 200);
  return cleaned.length >= 4 ? cleaned : null;
}
