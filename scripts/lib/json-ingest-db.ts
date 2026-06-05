import type { SupabaseClient } from '@supabase/supabase-js';

const PAGE = 1000;

/** source_file values already present in knowledge_chunks (video transcripts). */
export async function fetchIngestedJsonSourceFiles(
  admin: SupabaseClient
): Promise<Set<string>> {
  const files = new Set<string>();
  let offset = 0;

  for (;;) {
    const { data, error } = await admin
      .from('knowledge_chunks')
      .select('metadata')
      .range(offset, offset + PAGE - 1);

    if (error) throw new Error(error.message);
    if (!data?.length) break;

    for (const row of data) {
      const meta = row.metadata as Record<string, unknown> | null;
      if (meta?.source_type !== 'video_transcript') continue;
      const sf = typeof meta.source_file === 'string' ? meta.source_file.trim() : '';
      if (sf) files.add(sf);
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return files;
}
