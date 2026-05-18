import type { SupabaseClient } from '@supabase/supabase-js';
import {
  listBucketPdfPaths,
  normalizeStorageMatchKey,
} from '@/lib/rag-storage-path';

export type HealStoragePathsResult = {
  healed: { from: string; to: string; chunkRows: number }[];
  missing: string[];
  okPaths: number;
};

function coerceMeta(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

function metaPath(meta: unknown): string | null {
  const p = coerceMeta(meta).storage_path;
  return typeof p === 'string' && p.trim() ? p.trim() : null;
}

function metaBucket(meta: unknown, fallback: string): string {
  const b = coerceMeta(meta).storage_bucket;
  return typeof b === 'string' && b.trim() ? b.trim() : fallback;
}

function buildBucketIndex(bucketPaths: string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const p of bucketPaths) {
    const key = normalizeStorageMatchKey(p);
    if (!index.has(key)) index.set(key, p);
  }
  return index;
}

/**
 * Fix knowledge_chunks rows whose storage_path no longer matches Storage
 * (e.g. ™ removed from filename). Uses canonical paths from the bucket listing.
 */
export async function healStaleStoragePaths(
  admin: SupabaseClient,
  bucket: string,
  options?: { dryRun?: boolean }
): Promise<HealStoragePathsResult> {
  const dryRun = options?.dryRun ?? false;
  const bucketPaths = await listBucketPdfPaths(admin, bucket);
  const bucketSet = new Set(bucketPaths);
  const bucketIndex = buildBucketIndex(bucketPaths);

  const { data: rows, error } = await admin
    .from('knowledge_chunks')
    .select('id, metadata');

  if (error) throw error;

  /** stale storage_path → row ids */
  const staleIds = new Map<string, string[]>();

  for (const row of rows || []) {
    const storedPath = metaPath(row.metadata);
    if (!storedPath || metaBucket(row.metadata, bucket) !== bucket) continue;
    if (bucketSet.has(storedPath)) continue;

    const ids = staleIds.get(storedPath) ?? [];
    ids.push(row.id);
    staleIds.set(storedPath, ids);
  }

  const result: HealStoragePathsResult = {
    healed: [],
    missing: [],
    okPaths: bucketSet.size,
  };

  for (const [storedPath, ids] of staleIds) {
    const resolved = bucketIndex.get(normalizeStorageMatchKey(storedPath));

    if (!resolved) {
      result.missing.push(storedPath);
      continue;
    }

    if (!dryRun) {
      const { data: chunkRows, error: fetchErr } = await admin
        .from('knowledge_chunks')
        .select('id, metadata')
        .in('id', ids);

      if (fetchErr) {
        console.error(`  fetch failed for ${storedPath}:`, fetchErr.message);
        result.missing.push(storedPath);
        continue;
      }

      for (const chunk of chunkRows || []) {
        const meta = coerceMeta(chunk.metadata);
        const { error: updErr } = await admin
          .from('knowledge_chunks')
          .update({
            metadata: {
              ...meta,
              storage_bucket: bucket,
              storage_path: resolved,
            },
          })
          .eq('id', chunk.id);

        if (updErr) {
          console.error(`  update ${chunk.id}:`, updErr.message);
        }
      }
    }

    result.healed.push({
      from: storedPath,
      to: resolved,
      chunkRows: ids.length,
    });
  }

  return result;
}
