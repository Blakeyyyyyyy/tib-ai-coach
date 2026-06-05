import type { RagSource } from '@/lib/types';
import { isSessionCardRow } from '@/lib/ai/session-card';
import { parseMmSsToSeconds } from '@/lib/transcript-chunking';
import { resolveTranscriptSessionTitle } from '@/lib/transcript-display-title';

function metaString(m: Record<string, unknown> | null, key: string): string | null {
  if (!m || typeof m[key] !== 'string') return null;
  const v = (m[key] as string).trim();
  return v || null;
}

function isValidVideoUrl(url: string | null | undefined): boolean {
  const u = url?.trim();
  return !!u && !u.includes('example.com') && /^https?:\/\//i.test(u);
}

function resolveVideoUrlFromRow(row: {
  metadata: Record<string, unknown> | null;
  source_url?: string | null;
  resource_url?: string | null;
}): string | null {
  const meta = row.metadata;
  const candidates = [
    metaString(meta, 'video_url'),
    row.resource_url,
    row.source_url,
  ];
  for (const u of candidates) {
    if (isValidVideoUrl(u)) return u!.trim();
  }
  return null;
}

/** Session name for Knowledge base (no chunk timestamp suffix). */
export function citationDisplayTitle(
  metadata: Record<string, unknown> | null,
  sourceTitle: string
): string {
  const stored = metaString(metadata, 'session_display_title');
  if (stored) return stored;
  const videoName = metaString(metadata, 'video_name');
  const sourceFile = metaString(metadata, 'source_file');
  if (videoName || sourceFile) {
    return resolveTranscriptSessionTitle(
      sourceFile,
      videoName ?? sourceTitle,
      sourceTitle
    );
  }
  return sourceTitle
    .replace(/\s*\(\d{1,2}:\d{2}(?:[–-]\d{1,2}:\d{2})?\)\s*$/i, '')
    .trim();
}

/** Build a UI citation from a knowledge_chunks row. */
export function ragSourceFromRow(
  row: {
    id: string;
    source_title: string;
    source_url?: string | null;
    resource_url?: string | null;
    metadata: Record<string, unknown> | null;
  },
  title: string
): RagSource {
  const meta = row.metadata;

  if (isVideoTranscriptRow(meta)) {
    const videoName = metaString(meta, 'video_name');
    const startTime = metaString(meta, 'start_time');
    const endTime = metaString(meta, 'end_time');
    const displayTitle = isSessionCardRow(meta)
      ? citationDisplayTitle(meta, title)
      : videoTranscriptCitationTitle(meta, title);

    const videoUrlRaw = resolveVideoUrlFromRow(row);
    if (videoUrlRaw) {
      const videoUrl = startTime
        ? vimeoUrlAtTime(videoUrlRaw, startTime)
        : videoUrlRaw.split('#')[0]!;
      return {
        chunk_id: row.id,
        title: displayTitle,
        pdf_url: null,
        page_url: videoUrl,
        video_url: videoUrl,
        source_type: 'video_transcript',
        video_link_missing: false,
        video_name: videoName,
        start_time: startTime,
        end_time: endTime,
      };
    }
    return {
      chunk_id: row.id,
      title: displayTitle,
      pdf_url: null,
      page_url: null,
      video_url: null,
      source_type: 'video_transcript',
      video_link_missing: true,
      video_name: videoName,
      start_time: startTime,
      end_time: endTime,
    };
  }

  const displayTitle = citationDisplayTitle(meta, title);

  const bucket =
    metaString(meta, 'storage_bucket') ??
    process.env.RAG_STORAGE_BUCKET ??
    'Rag';
  const objectPath = metaString(meta, 'storage_path');
  const proxyHref = `/api/rag/pdf?chunk_id=${encodeURIComponent(row.id)}`;

  return {
    chunk_id: row.id,
    title: displayTitle,
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

/** Link for Knowledge base UI — video when URL exists; PDF uses storage proxy. */
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
  metadata: Record<string, unknown> | null,
  row?: { source_url?: string | null; resource_url?: string | null }
): boolean {
  return !!resolveVideoUrlFromRow({
    metadata,
    source_url: row?.source_url,
    resource_url: row?.resource_url,
  });
}

/** Citation label: session title + timestamp (for RAG context blocks). */
export function videoTranscriptCitationTitle(
  metadata: Record<string, unknown> | null,
  sourceTitle: string
): string {
  const videoName = metaString(metadata, 'video_name') || sourceTitle.trim() || 'Video';
  const sourceFile = metaString(metadata, 'source_file');
  const stored = metaString(metadata, 'session_display_title');
  const name =
    stored ||
    resolveTranscriptSessionTitle(sourceFile, videoName, sourceTitle);
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
