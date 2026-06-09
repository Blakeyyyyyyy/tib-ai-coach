/**
 * Backfill session-level metadata on knowledge_chunks:
 * - metadata.rag_topics (from catalog)
 * - metadata.coaching_intents (topic ids)
 * - metadata.session_summary (session cards only — short blurb)
 *
 * Usage: npm run backfill:session-metadata
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  getTopicById,
  inferRagTopicsFromTitle,
} from '../src/lib/ai/rag-topic-catalog';

config({ path: resolve(process.cwd(), '.env') });

type ChunkRow = {
  id: string;
  source_title: string;
  content: string;
  metadata: Record<string, unknown> | null;
};

function sessionSummaryFromContent(
  title: string,
  content: string,
  topicIds: string[]
): string {
  const labels = topicIds
    .map((id) => getTopicById(id)?.label)
    .filter(Boolean) as string[];
  const topicPart =
    labels.length > 0 ? `Topics: ${labels.slice(0, 4).join(', ')}.` : '';
  const preview = content
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
  return `TiB session "${title}". ${topicPart} ${preview}`.trim().slice(0, 480);
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

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
  const pageSize = 400;
  let scanned = 0;
  let updated = 0;

  for (;;) {
    const { data, error } = await admin
      .from('knowledge_chunks')
      .select('id, source_title, content, metadata')
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error(error.message);
      process.exit(1);
    }

    const rows = (data ?? []) as ChunkRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      const meta = { ...(row.metadata ?? {}) };
      const sourceFile =
        typeof meta.source_file === 'string' ? meta.source_file : null;
      const topics = inferRagTopicsFromTitle(row.source_title, sourceFile);
      const prevTopics = Array.isArray(meta.rag_topics) ? meta.rag_topics : [];
      const prevIntents = Array.isArray(meta.coaching_intents)
        ? meta.coaching_intents
        : [];

      const isSessionCard = meta.source_type === 'session_card';
      const summary = isSessionCard
        ? sessionSummaryFromContent(row.source_title, row.content, topics)
        : null;
      const prevSummary =
        typeof meta.session_summary === 'string' ? meta.session_summary : null;

      const sameTopics = arraysEqual(topics, prevTopics);
      const sameIntents = arraysEqual(topics, prevIntents);
      const sameSummary = !isSessionCard || summary === prevSummary;

      if (sameTopics && sameIntents && sameSummary) continue;

      const nextMeta: Record<string, unknown> = {
        ...meta,
        rag_topics: topics,
        coaching_intents: topics,
      };
      if (isSessionCard && summary) {
        nextMeta.session_summary = summary;
      }

      const { error: upErr } = await admin
        .from('knowledge_chunks')
        .update({ metadata: nextMeta })
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

  console.log(`Scanned ${scanned} chunks, updated metadata on ${updated}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
