/**
 * Ingest transcript_chunks.json (or similar) into knowledge_chunks.
 *
 * Expected shape per item:
 *   { video_name, video_url, start_time, end_time, text }
 *
 * Run: npm run ingest:json
 */

import { config } from 'dotenv';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { embedTexts } from '../src/lib/ai/openai-embed';

config({ path: resolve(process.cwd(), '.env') });

const DEFAULT_FILE = 'transcript_chunks.json';
const EMBED_BATCH = 24;

type TranscriptChunk = {
  video_name: string;
  video_url: string;
  start_time: string;
  end_time: string;
  text: string;
};

function formatContent(item: TranscriptChunk): string {
  const title = item.video_name.trim();
  const body = item.text.trim();
  return `Video: ${title} (${item.start_time}–${item.end_time})\n\n${body}`;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openai = process.env.OPENAI_API_KEY;
  if (!url || !key || !openai) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or OPENAI_API_KEY');
    process.exit(1);
  }

  const fileArg = process.argv.find((a) => a.endsWith('.json'));
  const fileName = fileArg ?? DEFAULT_FILE;
  const sourceFileKey = fileName;
  const filePath = resolve(process.cwd(), 'data', 'json', fileName);

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    console.error(`Could not read ${filePath}`);
    process.exit(1);
  }

  let items: TranscriptChunk[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error('Root must be a JSON array');
    items = parsed as TranscriptChunk[];
  } catch (e) {
    console.error('Invalid JSON:', e instanceof Error ? e.message : e);
    process.exit(1);
  }

  const valid = items.filter(
    (item) =>
      item?.video_name?.trim() &&
      item?.video_url?.trim() &&
      item?.text?.trim()
  );

  if (valid.length === 0) {
    console.log('No valid transcript rows found.');
    return;
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: delErr } = await admin
    .from('knowledge_chunks')
    .delete()
    .contains('metadata', { source_file: sourceFileKey });
  if (delErr) {
    console.error('Delete old transcript chunks:', delErr.message);
  }

  console.log(`Ingesting ${valid.length} transcript chunk(s) from ${fileName}…\n`);

  const contents = valid.map((item) => formatContent(item));

  for (let i = 0; i < contents.length; i += EMBED_BATCH) {
    const batchItems = valid.slice(i, i + EMBED_BATCH);
    const batch = contents.slice(i, i + EMBED_BATCH);
    const embeddings = await embedTexts(batch, openai);

    const rows = batchItems.map((item, j) => ({
      content: batch[j]!,
      embedding: embeddings[j] as unknown as number[],
      source_title: item.video_name.trim(),
      source_url: item.video_url.trim(),
      resource_url: item.video_url.trim(),
      metadata: {
        source_type: 'video_transcript',
        source_file: sourceFileKey,
        video_name: item.video_name.trim(),
        video_url: item.video_url.trim(),
        start_time: item.start_time,
        end_time: item.end_time,
        chunk_index: i + j,
      },
    }));

    const { error: insErr } = await admin.from('knowledge_chunks').insert(rows);
    if (insErr) {
      console.error('Insert error:', insErr.message);
      process.exit(1);
    }
    process.stdout.write(
      `  embedded ${Math.min(i + EMBED_BATCH, valid.length)}/${valid.length}\r`
    );
  }

  const videos = new Set(valid.map((v) => v.video_name));
  console.log(`\nDone: ${valid.length} chunks from ${videos.size} video(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
