import type { RagSource } from '@/lib/types';

/** Vimeo/base URL without #t= or ?query — one KB row per session video. */
function videoUrlDedupeBase(url: string): string {
  const noHash = url.trim().split('#')[0]!;
  const q = noHash.indexOf('?');
  return q === -1 ? noHash : noHash.slice(0, q);
}

/** Prefer stable Storage identity; else URL without query (signed URLs differ per token). */
function citationDedupeKey(s: RagSource): string {
  if (s.source_type === 'video_transcript') {
    if (s.video_url) {
      return `video:${videoUrlDedupeBase(s.video_url)}`;
    }
    const session = (s.video_name || s.title)
      .replace(/\s*\(\d{1,2}:\d{2}(?:[–-]\d{1,2}:\d{2})?\)\s*$/i, '')
      .trim()
      .toLowerCase();
    return `video-name:${session}`;
  }
  if (s.storage_bucket && s.storage_path) {
    return `doc:${s.storage_bucket}\0${s.storage_path}`;
  }
  const raw = (s.video_url || s.pdf_url || s.page_url || '').trim();
  if (raw) {
    const q = raw.indexOf('?');
    const base = q === -1 ? raw : raw.slice(0, q);
    return `u:${base}`;
  }
  return `t:${s.title.trim().toLowerCase()}\0${s.chunk_id}`;
}

/**
 * One row per document (by URL path or title+chunk), preserving order.
 * `maxLinks` caps list length (safety); server usually sends ≤1 in single-source mode.
 */
export function dedupeRagSourcesForDisplay(
  sources: RagSource[],
  maxLinks = 3
): RagSource[] {
  const out: RagSource[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    const key = citationDedupeKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= maxLinks) break;
  }
  return out;
}
