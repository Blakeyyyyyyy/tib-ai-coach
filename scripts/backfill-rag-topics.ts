/**
 * Tag knowledge_chunks with metadata.rag_topics from title/source file (session cards + content).
 *
 * Usage: npm run ingest:rag-topics
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { inferRagTopicsFromTitle } from '../src/lib/ai/rag-topic-catalog';

config({ path: resolve(process.cwd(), '.env') });

type ChunkRow = {
  id: string;
  source_title: string;
  metadata: Record<string, unknown> | null;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing Supabase env');
    process.exit(1);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let offset = 0;
  const pageSize = 500;
  let updated = 0;
  let scanned = 0;

  for (;;) {
    const { data, error } = await admin
      .from('knowledge_chunks')
      .select('id, source_title, metadata')
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error(error.message);
      process.exit(1);
    }
    const rows = (data ?? []) as ChunkRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      const meta = row.metadata ?? {};
      const sourceFile =
        typeof meta.source_file === 'string' ? meta.source_file : null;
      const topics = inferRagTopicsFromTitle(row.source_title, sourceFile);
      const prev = Array.isArray(meta.rag_topics) ? meta.rag_topics : [];
      const same =
        topics.length === prev.length &&
        topics.every((t, i) => t === prev[i]);
      if (same) continue;

      const { error: upErr } = await admin
        .from('knowledge_chunks')
        .update({
          metadata: { ...meta, rag_topics: topics },
        })
        .eq('id', row.id);

      if (upErr) {
        console.error(row.id, upErr.message);
        continue;
      }
      updated++;
    }

    offset += pageSize;
    if (rows.length < pageSize) break;
  }

  console.log(`Scanned ${scanned} chunks, updated rag_topics on ${updated}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
