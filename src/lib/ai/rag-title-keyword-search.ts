import type { SupabaseClient } from '@supabase/supabase-js';
import type { PhraseChunkRow } from '@/lib/ai/rag-phrase-search';
import {
  entityAnchorTerms,
  titleSearchTerms,
} from '@/lib/ai/rag-query-terms';

export const TITLE_KEYWORD_MATCH_SIMILARITY = 0.993;

function escapeIlike(pattern: string): string {
  return pattern.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Match knowledge_chunks whose source_title contains salient query terms
 * (speakers, PDF names, session titles).
 */
export async function fetchTitleKeywordMatches(
  admin: SupabaseClient,
  userQuery: string,
  limitPerTerm = 16
): Promise<PhraseChunkRow[]> {
  const entityTerms = entityAnchorTerms(userQuery);
  const terms =
    entityTerms.length > 0 ? entityTerms : titleSearchTerms(userQuery, 8);
  if (terms.length === 0) return [];

  // Also search chunk body for high-signal phrases (e.g. "most hopeful").
  const contentTerms = titleSearchTerms(userQuery, 4);

  const seen = new Set<string>();
  const out: PhraseChunkRow[] = [];

  const push = (row: {
    id: string;
    content: string;
    source_title: string;
    source_url: string | null;
    resource_url: string | null;
    metadata: unknown;
  }) => {
    if (!row?.id || seen.has(row.id)) return;
    seen.add(row.id);
    out.push({
      id: row.id,
      content: row.content,
      source_title: row.source_title,
      source_url: row.source_url,
      resource_url: row.resource_url,
      metadata: row.metadata as Record<string, unknown> | null,
    });
  };

  for (const term of terms) {
    if (term.length < 3) continue;
    const pattern = `%${escapeIlike(term)}%`;

    const { data: byTitle, error: e1 } = await admin
      .from('knowledge_chunks')
      .select('id, content, source_title, source_url, resource_url, metadata')
      .ilike('source_title', pattern)
      .limit(limitPerTerm);

    if (e1) console.error('title keyword source_title:', e1.message);
    for (const row of byTitle ?? []) push(row);

    const { data: byVideoLine, error: e2 } = await admin
      .from('knowledge_chunks')
      .select('id, content, source_title, source_url, resource_url, metadata')
      .ilike('content', `Video: ${escapeIlike(term)}%`)
      .limit(limitPerTerm);

    if (e2) console.error('title keyword video line:', e2.message);
    for (const row of byVideoLine ?? []) push(row);
  }

  for (const term of contentTerms) {
    if (term.length < 6) continue;
    const pattern = `%${escapeIlike(term)}%`;
    const { data: byContent, error: e3 } = await admin
      .from('knowledge_chunks')
      .select('id, content, source_title, source_url, resource_url, metadata')
      .ilike('content', pattern)
      .limit(limitPerTerm);
    if (e3) console.error('title keyword content:', e3.message);
    for (const row of byContent ?? []) push(row);
  }

  return out;
}
