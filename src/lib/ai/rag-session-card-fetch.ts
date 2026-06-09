import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchRow } from '@/lib/ai/rag-merge';
import {
  explicitSessionAnchor,
  detectSourceFileInQuery,
} from '@/lib/ai/rag-retrieval-mode';
import {
  sessionTitleMatchScore,
  extractExplicitSessionTitle,
} from '@/lib/ai/rag-explicit-session';
import { TITLE_KEYWORD_MATCH_SIMILARITY } from '@/lib/ai/rag-title-keyword-search';

const SESSION_CARD_SIMILARITY = 0.96;

function escapeIlike(pattern: string): string {
  return pattern.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function rowFromDb(
  row: {
    id: string;
    content: string;
    source_title: string;
    source_url: string | null;
    resource_url: string | null;
    metadata: Record<string, unknown> | null;
  },
  similarity = SESSION_CARD_SIMILARITY
): MatchRow {
  return {
    id: row.id,
    content: row.content,
    source_title: row.source_title,
    source_url: row.source_url,
    resource_url: row.resource_url,
    metadata: row.metadata,
    similarity,
  };
}

/** Session cards for a named session / filename — routes retrieval to the right document. */
export async function fetchSessionCardMatches(
  admin: SupabaseClient,
  userQuery: string,
  limit = 3
): Promise<MatchRow[]> {
  const anchor = explicitSessionAnchor(userQuery);
  const sourceFile = detectSourceFileInQuery(userQuery);
  if (!anchor && !sourceFile) return [];

  const seen = new Set<string>();
  const candidates: MatchRow[] = [];

  if (sourceFile) {
    const { data, error } = await admin
      .from('knowledge_chunks')
      .select('id, content, source_title, source_url, resource_url, metadata')
      .eq('metadata->>source_type', 'session_card')
      .ilike('metadata->>source_file', `%${escapeIlike(sourceFile)}%`)
      .limit(6);

    if (error) {
      console.error('session card file fetch:', error.message);
    } else {
      for (const row of data ?? []) {
        if (!row?.id || seen.has(row.id)) continue;
        seen.add(row.id);
        candidates.push(
          rowFromDb({
            ...row,
            metadata: row.metadata as Record<string, unknown> | null,
          })
        );
      }
    }
  }

  if (anchor && candidates.length < limit) {
    const slice = anchor.slice(0, Math.min(anchor.length, 72));
    const pattern = `%${escapeIlike(slice)}%`;
    const { data, error } = await admin
      .from('knowledge_chunks')
      .select('id, content, source_title, source_url, resource_url, metadata')
      .eq('metadata->>source_type', 'session_card')
      .ilike('source_title', pattern)
      .limit(12);

    if (error) {
      console.error('session card title fetch:', error.message);
    } else {
      for (const row of data ?? []) {
        if (!row?.id || seen.has(row.id)) continue;
        seen.add(row.id);
        candidates.push(
          rowFromDb({
            ...row,
            metadata: row.metadata as Record<string, unknown> | null,
          })
        );
      }
    }
  }

  const titleAnchor = extractExplicitSessionTitle(userQuery) ?? anchor;
  if (!titleAnchor) return candidates.slice(0, limit);

  return candidates
    .map((row) => ({
      row,
      score: sessionTitleMatchScore(titleAnchor, row.source_title),
    }))
    .sort((a, b) => b.score - a.score)
    .filter((s) => s.score >= 40 || Boolean(sourceFile))
    .slice(0, limit)
    .map((s) => s.row);
}

/** Content chunks from the document tied to a matched session card. */
export async function fetchContentChunksForSessionCard(
  admin: SupabaseClient,
  sessionCard: MatchRow,
  limitPerFile = 14
): Promise<MatchRow[]> {
  const meta = sessionCard.metadata;
  if (!meta) return [];

  const sourceFile =
    typeof meta.source_file === 'string' ? meta.source_file.trim() : '';
  const storagePath =
    typeof meta.storage_path === 'string' ? meta.storage_path.trim() : '';

  if (!sourceFile && !storagePath) return [];

  let query = admin
    .from('knowledge_chunks')
    .select('id, content, source_title, source_url, resource_url, metadata')
    .neq('metadata->>source_type', 'session_card')
    .limit(limitPerFile);

  if (sourceFile) {
    query = query.contains('metadata', { source_file: sourceFile });
  } else if (storagePath) {
    query = query.contains('metadata', { storage_path: storagePath });
  }

  const { data, error } = await query;
  if (error) {
    console.error('session card content fetch:', error.message);
    return [];
  }

  return (data ?? []).map((row) =>
    rowFromDb(
      {
        ...row,
        metadata: row.metadata as Record<string, unknown> | null,
      },
      TITLE_KEYWORD_MATCH_SIMILARITY
    )
  );
}
