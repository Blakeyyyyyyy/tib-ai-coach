import type { SupabaseClient } from '@supabase/supabase-js';
import { embedTexts } from '@/lib/ai/openai-embed';
import {
  buildPdfSessionCardContent,
  buildVideoSessionCardContent,
} from '@/lib/ai/session-card';
import { inferRagTopicsFromTitle } from '@/lib/ai/rag-topic-catalog';

export async function upsertVideoSessionCard(
  admin: SupabaseClient,
  openaiKey: string,
  opts: {
    sessionTitle: string;
    sourceFile: string;
    videoName: string;
    videoUrl?: string | null;
    segmentTexts: string[];
  }
): Promise<void> {
  const content = buildVideoSessionCardContent(opts);
  const [embedding] = await embedTexts([content], openaiKey);
  const ragTopics = inferRagTopicsFromTitle(opts.sessionTitle, opts.sourceFile);

  await admin
    .from('knowledge_chunks')
    .delete()
    .contains('metadata', {
      source_file: opts.sourceFile,
      source_type: 'session_card',
    });

  const { error } = await admin.from('knowledge_chunks').insert({
    content,
    embedding: embedding as unknown as number[],
    source_title: opts.sessionTitle,
    source_url: opts.videoUrl ?? null,
    resource_url: opts.videoUrl ?? null,
    metadata: {
      source_type: 'session_card',
      parent_source_type: 'video_transcript',
      source_file: opts.sourceFile,
      video_name: opts.videoName,
      session_display_title: opts.sessionTitle,
      video_url: opts.videoUrl ?? null,
      chunk_index: -1,
      rag_topics: ragTopics,
    },
  });

  if (error) throw new Error(`session card ${opts.sourceFile}: ${error.message}`);
}

export async function upsertPdfSessionCard(
  admin: SupabaseClient,
  openaiKey: string,
  opts: {
    title: string;
    storagePath: string;
    bucket: string;
    chunkTexts: string[];
  }
): Promise<void> {
  const content = buildPdfSessionCardContent(opts);
  const [embedding] = await embedTexts([content], openaiKey);
  const ragTopics = inferRagTopicsFromTitle(opts.title, opts.storagePath);

  await admin
    .from('knowledge_chunks')
    .delete()
    .contains('metadata', {
      storage_path: opts.storagePath,
      storage_bucket: opts.bucket,
      source_type: 'session_card',
    });

  const { error } = await admin.from('knowledge_chunks').insert({
    content,
    embedding: embedding as unknown as number[],
    source_title: opts.title,
    source_url: null,
    resource_url: null,
    metadata: {
      source_type: 'session_card',
      parent_source_type: 'pdf',
      storage_bucket: opts.bucket,
      storage_path: opts.storagePath,
      session_display_title: opts.title,
      chunk_index: -1,
      rag_topics: ragTopics,
    },
  });

  if (error) throw new Error(`session card PDF ${opts.storagePath}: ${error.message}`);
}
