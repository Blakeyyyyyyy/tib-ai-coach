import type { RagSource } from '@/lib/types';
import { parseMmSsToSeconds } from '@/lib/transcript-chunking';

function metaString(m: Record<string, unknown> | null, key: string): string | null {
  if (!m || typeof m[key] !== 'string') return null;
  const v = (m[key] as string).trim();
  return v || null;
}

/** Build a UI citation from a knowledge_chunks row. */
export function ragSourceFromRow(
  row: {
    id: string;
    source_title: string;
    metadata: Record<string, unknown> | null;
  },
  title: string
): RagSource {
  const meta = row.metadata;
  const sourceType = metaString(meta, 'source_type');

  if (sourceType === 'video_transcript') {
    const baseUrl = metaString(meta, 'video_url');
    const start = metaString(meta, 'start_time');
    const videoUrl =
      baseUrl && start ? vimeoUrlAtTime(baseUrl, start) : baseUrl;
    return {
      chunk_id: row.id,
      title,
      pdf_url: null,
      page_url: videoUrl,
      video_url: videoUrl,
      source_type: 'video_transcript',
    };
  }

  const bucket =
    metaString(meta, 'storage_bucket') ??
    process.env.RAG_STORAGE_BUCKET ??
    'Rag';
  const objectPath = metaString(meta, 'storage_path');
  const proxyHref = `/api/rag/pdf?chunk_id=${encodeURIComponent(row.id)}`;

  return {
    chunk_id: row.id,
    title,
    pdf_url: proxyHref,
    page_url: proxyHref,
    source_type: 'pdf',
    storage_bucket: bucket,
    storage_path: objectPath,
  };
}

export function isVideoTranscriptRow(
  metadata: Record<string, unknown> | null
): boolean {
  return metaString(metadata, 'source_type') === 'video_transcript';
}

/** Vimeo deep link at transcript start (e.g. #t=90s). */
export function vimeoUrlAtTime(baseUrl: string, startTime: string): string {
  const sec = parseMmSsToSeconds(startTime);
  const withoutHash = baseUrl.trim().split('#')[0]!;
  return `${withoutHash}#t=${sec}s`;
}
