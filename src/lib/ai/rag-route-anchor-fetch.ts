import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionRoute } from '@/lib/ai/rag-session-router';
import { TITLE_KEYWORD_MATCH_SIMILARITY } from '@/lib/ai/rag-title-keyword-search';
import type { MatchRow } from '@/lib/ai/rag-merge';

function escapeIlike(pattern: string): string {
  return pattern.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Pull chunks for the routed session when hybrid search missed it. */
export async function fetchRouteAnchorChunks(
  admin: SupabaseClient,
  route: SessionRoute,
  limitPerTerm = 10
): Promise<MatchRow[]> {
  const terms = route.topic.titleSearchTerms ?? [route.label];
  const seen = new Set<string>();
  const out: MatchRow[] = [];

  for (const term of terms) {
    if (term.length < 4) continue;
    const pattern = `%${escapeIlike(term)}%`;
    const { data, error } = await admin
      .from('knowledge_chunks')
      .select('id, content, source_title, source_url, resource_url, metadata')
      .ilike('source_title', pattern)
      .limit(limitPerTerm);

    if (error) {
      console.error('route anchor fetch:', error.message);
      continue;
    }

    for (const row of data ?? []) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      out.push({
        id: row.id,
        content: row.content,
        source_title: row.source_title,
        source_url: row.source_url,
        resource_url: row.resource_url,
        metadata: row.metadata as Record<string, unknown> | null,
        similarity: TITLE_KEYWORD_MATCH_SIMILARITY,
      });
    }
  }

  return out;
}

export function mergeRouteAnchorsIntoMatches(
  matches: MatchRow[],
  anchors: MatchRow[]
): MatchRow[] {
  if (anchors.length === 0) return matches;
  const ids = new Set(matches.map((m) => m.id));
  const merged = [...matches];
  for (const row of anchors) {
    if (!ids.has(row.id)) {
      ids.add(row.id);
      merged.push(row);
    }
  }
  return merged;
}
