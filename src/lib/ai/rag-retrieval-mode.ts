import { extractExplicitSessionTitle } from '@/lib/ai/rag-explicit-session';
import {
  hasExactSessionMatch,
  isVagueUserQuery,
} from '@/lib/ai/rag-rewrite-gate';

export type RetrievalMode = 'explicit_session' | 'vague' | 'specific';

/** Detect user naming a source file (e.g. "CF Challenge 1.json"). */
export function detectSourceFileInQuery(userQuery: string): string | null {
  const q = userQuery.replace(/\s+/g, ' ').trim();
  const m = q.match(/\b([A-Za-z0-9][\w\s\-'(),.&]*\.(?:json|pdf))\b/i);
  if (!m?.[1]) return null;
  const file = m[1].trim();
  return file.length >= 6 ? file : null;
}

export function explicitSessionAnchor(userQuery: string): string | null {
  return (
    extractExplicitSessionTitle(userQuery) ??
    detectSourceFileInQuery(userQuery)
  );
}

/** How retrieval should treat the user query (rewrite + routing strategy). */
export function classifyRetrievalMode(userQuery: string): RetrievalMode {
  if (hasExactSessionMatch(userQuery) || detectSourceFileInQuery(userQuery)) {
    return 'explicit_session';
  }
  if (isVagueUserQuery(userQuery)) {
    return 'vague';
  }
  return 'specific';
}

export function shouldRunKeywordExpansion(mode: RetrievalMode): boolean {
  return mode === 'vague';
}

export function shouldUseSessionCardRouting(mode: RetrievalMode): boolean {
  return mode === 'explicit_session';
}
