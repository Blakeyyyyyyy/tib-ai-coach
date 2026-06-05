import { signalPhrasesFromQuery, titleSearchTerms } from '@/lib/ai/rag-query-terms';

/** Richer text for query embedding (not shown to the model). */
export function embeddingQueryText(userQuery: string): string {
  const signals = signalPhrasesFromQuery(userQuery);
  const terms = titleSearchTerms(userQuery, 10);
  const extra = [...new Set([...signals, ...terms])].filter(Boolean);
  if (extra.length === 0) return userQuery;
  return `${userQuery.trim()}\n\nRelated concepts: ${extra.join('; ')}`;
}
