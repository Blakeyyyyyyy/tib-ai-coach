/**
 * Ingest transcript JSON into knowledge_chunks.
 *
 * Run: npx tsx scripts/ingest-json-transcripts.ts [filename.json]
 */

import { config } from 'dotenv';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { embedTexts } from '../src/lib/ai/openai-embed';
import { resolveTranscriptSessionTitle } from '../src/lib/transcript-display-title';
import { upsertVideoSessionCard } from '../src/lib/ai/upsert-session-card';
config({ path: resolve(process.cwd(), '.env') });

const EMBED_BATCH =
  parseInt(process.env.RAG_JSON_EMBED_BATCH ?? '32', 10) || 32;

export type TranscriptChunk = {
  video_name: string;
  video_url?: string;
  start_time?: string;
  end_time?: string;
  text: string;
};

function formatContent(item: TranscriptChunk, sessionTitle: string): string {
  const title = sessionTitle;
  const body = item.text.trim();
  const start = item.start_time?.trim();
  const end = item.end_time?.trim();
  const time =
    start && end ? ` (${start}–${end})` : start ? ` (${start})` : '';
  return `Video: ${title}${time}\n\n${body}`;
}

function resolveVideoUrl(
  item: TranscriptChunk,
  fileLevelUrl: string | null
): string | null {
  const u = item.video_url?.trim();
  if (u && !u.includes('example.com')) return u;
  if (fileLevelUrl) return fileLevelUrl;
  return null;
}

/** First chunk in the file with a real Vimeo URL applies to the whole session. */
function resolveFileLevelVideoUrl(valid: TranscriptChunk[]): string | null {
  for (const item of valid) {
    const u = item.video_url?.trim();
    if (u && !u.includes('example.com')) return u;
  }
  return null;
}

export type IngestJsonResult = {
  fileName: string;
  chunkCount: number;
  videoCount: number;
  skipped?: boolean;
};

export async function ingestJsonTranscriptFile(
  fileName: string,
  options?: {
    admin?: SupabaseClient;
    openaiKey?: string;
    skipIfExists?: boolean;
  }
): Promise<IngestJsonResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openai = options?.openaiKey ?? process.env.OPENAI_API_KEY;
  if (!url || !key || !openai) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or OPENAI_API_KEY'
    );
  }

  const admin =
    options?.admin ??
    createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

  const sourceFileKey = fileName;
  const filePath = resolve(process.cwd(), 'data', 'json', fileName);

  if (options?.skipIfExists) {
    const { count } = await admin
      .from('knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .contains('metadata', { source_file: sourceFileKey, source_type: 'video_transcript' });
    if (count && count > 0) {
      return { fileName, chunkCount: count, videoCount: 0, skipped: true };
    }
  }

  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Root must be a JSON array');
  const items = parsed as TranscriptChunk[];

  const valid = items.filter(
    (item) => item?.video_name?.trim() && item?.text?.trim()
  );

  if (valid.length === 0) {
    return { fileName, chunkCount: 0, videoCount: 0 };
  }

  const { error: delErr } = await admin
    .from('knowledge_chunks')
    .delete()
    .contains('metadata', {
      source_file: sourceFileKey,
      source_type: 'video_transcript',
    });
  if (delErr) {
    throw new Error(`Delete old chunks for ${fileName}: ${delErr.message}`);
  }

  const sessionTitle = resolveTranscriptSessionTitle(
    sourceFileKey,
    valid[0]!.video_name.trim()
  );

  const fileLevelVideoUrl = resolveFileLevelVideoUrl(valid);

  const contents = valid.map((item) =>
    formatContent(item, sessionTitle)
  );

  for (let i = 0; i < contents.length; i += EMBED_BATCH) {
    const batchItems = valid.slice(i, i + EMBED_BATCH);
    const batch = contents.slice(i, i + EMBED_BATCH);
    const embeddings = await embedTexts(batch, openai);

    const rows = batchItems.map((item, j) => {
      const videoUrl = resolveVideoUrl(item, fileLevelVideoUrl);
      const meta: Record<string, unknown> = {
        source_type: 'video_transcript',
        source_file: sourceFileKey,
        video_name: item.video_name.trim(),
        session_display_title: sessionTitle,
        start_time: item.start_time ?? null,
        end_time: item.end_time ?? null,
        chunk_index: i + j,
        has_video_url: !!videoUrl,
      };
      if (videoUrl) meta.video_url = videoUrl;
      return {
        content: batch[j]!,
        embedding: embeddings[j] as unknown as number[],
        source_title: sessionTitle,
        source_url: videoUrl,
        resource_url: videoUrl,
        metadata: meta,
      };
    });

    const { error: insErr } = await admin.from('knowledge_chunks').insert(rows);
    if (insErr) {
      throw new Error(`Insert ${fileName} batch @${i}: ${insErr.message}`);
    }
  }

  const videoUrl = resolveVideoUrl(valid[0]!, fileLevelVideoUrl);
  await upsertVideoSessionCard(admin, openai, {
    sessionTitle,
    sourceFile: sourceFileKey,
    videoName: valid[0]!.video_name.trim(),
    videoUrl,
    segmentTexts: valid.slice(0, 40).map((v) => v.text),
  });

  const videos = new Set(valid.map((v) => v.video_name));
  return {
    fileName,
    chunkCount: valid.length + 1,
    videoCount: videos.size,
  };
}

async function main() {
  const fileArg = process.argv.find((a) => a.endsWith('.json'));
  const fileName = fileArg ?? 'transcript_chunks.json';

  console.log(`Ingesting ${fileName}…\n`);
  const result = await ingestJsonTranscriptFile(fileName);
  console.log(
    `Done: ${result.chunkCount} chunks from ${result.videoCount} video(s).`
  );
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').includes('ingest-json-transcripts');
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
