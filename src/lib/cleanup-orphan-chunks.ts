import type { SupabaseClient } from '@supabase/supabase-js';
import { listBucketPdfPaths } from '@/lib/rag-storage-path';

export type OrphanCleanupResult = {
  deletedChunkRows: number;
  orphanPaths: { path: string; chunkRows: number }[];
  noPathChunkRows: number;
  keptChunkRows: number;
};

function metaPath(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const p = (meta as Record<string, unknown>).storage_path;
  return typeof p === 'string' && p.trim() ? p.trim() : null;
}

function metaBucket(meta: unknown, fallback: string): string {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return fallback;
  const b = (meta as Record<string, unknown>).storage_bucket;
  return typeof b === 'string' && b.trim() ? b.trim() : fallback;
}

/**
 * Delete knowledge_chunks whose storage_path is not in the Storage bucket
 * (e.g. after duplicate PDFs were removed from Rag).
 */
export async function cleanupOrphanKnowledgeChunks(
  admin: SupabaseClient,
  bucket: string,
  options?: { dryRun?: boolean }
): Promise<OrphanCleanupResult> {
  const dryRun = options?.dryRun ?? false;
  const bucketPaths = await listBucketPdfPaths(admin, bucket);
  const validPaths = new Set(bucketPaths);

  const rows: { id: string; metadata: unknown }[] = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await admin
      .from('knowledge_chunks')
      .select('id, metadata')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  const orphanIds: string[] = [];
  const noPathIds: string[] = [];
  const orphanByPath = new Map<string, string[]>();
  let kept = 0;

  for (const row of rows) {
    const path = metaPath(row.metadata);
    const b = metaBucket(row.metadata, bucket);

    if (b !== bucket) {
      kept++;
      continue;
    }

    if (!path) {
      noPathIds.push(row.id);
      continue;
    }

    if (validPaths.has(path)) {
      kept++;
      continue;
    }

    orphanIds.push(row.id);
    const list = orphanByPath.get(path) ?? [];
    list.push(row.id);
    orphanByPath.set(path, list);
  }

  const orphanPaths = [...orphanByPath.entries()]
    .map(([path, ids]) => ({ path, chunkRows: ids.length }))
    .sort((a, b) => b.chunkRows - a.chunkRows);

  const toDelete = [...orphanIds, ...noPathIds];

  if (!dryRun && toDelete.length > 0) {
    const batchSize = 200;
    for (let i = 0; i < toDelete.length; i += batchSize) {
      const batch = toDelete.slice(i, i + batchSize);
      const { error: delErr } = await admin
        .from('knowledge_chunks')
        .delete()
        .in('id', batch);
      if (delErr) throw delErr;
    }
  }

  return {
    deletedChunkRows: dryRun ? 0 : toDelete.length,
    orphanPaths,
    noPathChunkRows: noPathIds.length,
    keptChunkRows: kept,
  };
}
