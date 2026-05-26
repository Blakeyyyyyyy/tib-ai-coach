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
    const rawUrl = metaString(meta, 'video_url');
    const baseUrl =
      rawUrl && !rawUrl.includes('example.com') ? rawUrl : null;
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
  if (metaString(metadata, 'source_type') === 'video_transcript') return true;
  const hasVideoName = !!metaString(metadata, 'video_name');
  const hasStorage = !!metaString(metadata, 'storage_path');
  const sourceFile = metaString(metadata, 'source_file');
  return (
    hasVideoName &&
    !hasStorage &&
    (!!sourceFile?.endsWith('.json') || metaString(metadata, 'start_time') != null)
  );
}

/** Link for Knowledge base UI — video only when URL exists; PDF uses storage proxy. */
export function citationHrefFromSource(src: RagSource): string | null {
  if (src.source_type === 'video_transcript') {
    return src.video_url?.trim() || null;
  }
  if (src.source_type === 'pdf') {
    return src.pdf_url?.trim() || src.page_url?.trim() || null;
  }
  if (src.video_url?.trim()) return src.video_url.trim();
  if (src.pdf_url?.trim()) return src.pdf_url.trim();
  return null;
}

/** True when chunk has a real Vimeo (or other) link for citations. */
export function hasVideoCitationUrl(
  metadata: Record<string, unknown> | null
): boolean {
  const raw = metaString(metadata, 'video_url');
  return !!raw && !raw.includes('example.com');
}

/** Citation label: video_name + timestamp range (with or without URL). */
export function videoTranscriptCitationTitle(
  metadata: Record<string, unknown> | null,
  sourceTitle: string
): string {
  const name =
    metaString(metadata, 'video_name') || sourceTitle.trim() || 'Video';
  const start = metaString(metadata, 'start_time');
  const end = metaString(metadata, 'end_time');
  if (start && end) return `${name} (${start}–${end})`;
  if (start) return `${name} (${start})`;
  return name;
}

/** Vimeo deep link at transcript start (e.g. #t=90s). */
export function vimeoUrlAtTime(baseUrl: string, startTime: string): string {
  const sec = parseMmSsToSeconds(startTime);
  const withoutHash = baseUrl.trim().split('#')[0]!;
  return `${withoutHash}#t=${sec}s`;
}
