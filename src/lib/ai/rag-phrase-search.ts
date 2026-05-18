import type { SupabaseClient } from '@supabase/supabase-js';

export type PhraseChunkRow = {
  id: string;
  content: string;
  source_title: string;
  source_url: string | null;
  resource_url: string | null;
  metadata: Record<string, unknown> | null;
};

/** Similarity score assigned to literal phrase hits (beats generic vector matches). */
export const PHRASE_MATCH_SIMILARITY = 0.99;

function normalizeForPhraseSearch(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeIlike(pattern: string): string {
  return pattern.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Phrases worth scanning in chunk text (quoted line, or long enough substring). */
export function phraseSearchCandidates(userQuery: string): string[] {
  const normalized = normalizeForPhraseSearch(userQuery);
  const stripped = normalized.replace(/^["']+|["']+$/g, '').trim();
  if (stripped.length < 10) return [];

  const candidates = new Set<string>([stripped]);
  // PDF text may use curly apostrophe
  if (stripped.includes("'")) {
    candidates.add(stripped.replace(/'/g, '\u2019'));
  }
  return [...candidates];
}

export function chunkContainsPhrase(
  content: string,
  candidates: string[]
): boolean {
  const hay = normalizeForPhraseSearch(content).toLowerCase();
  for (const c of candidates) {
    if (hay.includes(normalizeForPhraseSearch(c).toLowerCase())) return true;
  }
  return false;
}

/**
 * Literal substring search in knowledge_chunks.content (case-insensitive).
 * Catches exact quotes that vector search often misses.
 */
export async function fetchPhraseMatches(
  admin: SupabaseClient,
  userQuery: string,
  limit = 10
): Promise<PhraseChunkRow[]> {
  const candidates = phraseSearchCandidates(userQuery);
  if (candidates.length === 0) return [];

  const seen = new Set<string>();
  const out: PhraseChunkRow[] = [];

  for (const phrase of candidates) {
    const { data, error } = await admin
      .from('knowledge_chunks')
      .select(
        'id, content, source_title, source_url, resource_url, metadata'
      )
      .ilike('content', `%${escapeIlike(phrase)}%`)
      .limit(limit);

    if (error) {
      console.error('phrase search:', error.message);
      continue;
    }

    for (const row of data || []) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      out.push({
        id: row.id,
        content: row.content,
        source_title: row.source_title,
        source_url: row.source_url,
        resource_url: row.resource_url,
        metadata: row.metadata as Record<string, unknown> | null,
      });
    }
  }

  return out;
}
