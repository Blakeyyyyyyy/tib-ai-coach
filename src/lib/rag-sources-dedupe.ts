import type { RagSource } from '@/lib/types';

/** Prefer stable Storage identity; else URL without query (signed URLs differ per token). */
function citationDedupeKey(s: RagSource): string {
  if (s.storage_bucket && s.storage_path) {
    return `doc:${s.storage_bucket}\0${s.storage_path}`;
  }
  const raw = (s.pdf_url || s.page_url || '').trim();
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
