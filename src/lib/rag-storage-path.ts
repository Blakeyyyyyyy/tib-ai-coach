import type { SupabaseClient } from '@supabase/supabase-js';

/** Compare paths/titles ignoring ™, punctuation, and common ingest typos (WorkshopT). */
export function normalizeStorageMatchKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[™®©]/g, '')
    .replace(/workshopt/g, 'workshop')
    .replace(/[^a-z0-9]+/g, '');
}

export async function listBucketPdfPaths(
  client: SupabaseClient,
  bucket: string,
  prefix = ''
): Promise<string[]> {
  const { data, error } = await client.storage.from(bucket).list(prefix, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  });
  if (error) throw error;
  const out: string[] = [];
  for (const item of data || []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.metadata === null) {
      out.push(...(await listBucketPdfPaths(client, bucket, path)));
    } else if (item.name.toLowerCase().endsWith('.pdf')) {
      out.push(path);
    }
  }
  return out;
}

export function pathVariants(objectPath: string): string[] {
  const trimmed = objectPath.trim().replace(/^\/+/, '');
  const variants = new Set<string>([trimmed]);
  try {
    variants.add(decodeURIComponent(trimmed));
  } catch {
    /* ignore */
  }

  const expand = (p: string) => {
    variants.add(p);
    // Storage file renamed without ™ (e.g. Workshop™ → Workshop)
    const noMark = p.replace(/[™®©]/g, '');
    variants.add(noMark);
    variants.add(noMark.replace(/--+/g, '-').replace(/-\./g, '.'));
    variants.add(p.replace(/™/g, 'T'));
    variants.add(p.replace(/WorkshopT/gi, 'Workshop'));
    variants.add(p.replace(/Workshop™/gi, 'Workshop'));
    variants.add(p.replace(/Workshop™/gi, 'WorkshopT'));
  };

  for (const p of [...variants]) expand(p);
  return [...variants].filter(Boolean);
}

/**
 * Resolve a Storage object key and return a signed URL, with fallbacks when
 * metadata path no longer matches the file in the bucket (renames, ™ vs T, etc.).
 */
/** Find the real Storage object key when metadata path is stale (™ dropped, renamed, etc.). */
export async function resolveStorageObjectPath(
  admin: SupabaseClient,
  bucket: string,
  objectPath: string,
  titleHint?: string | null
): Promise<string | null> {
  for (const path of pathVariants(objectPath)) {
    const { error } = await admin.storage.from(bucket).download(path);
    if (!error) return path;
  }

  const keys = new Set<string>();
  keys.add(normalizeStorageMatchKey(objectPath));
  if (titleHint) keys.add(normalizeStorageMatchKey(titleHint));

  try {
    const all = await listBucketPdfPaths(admin, bucket);
    const index = new Map<string, string>();
    for (const candidate of all) {
      const cKey = normalizeStorageMatchKey(candidate);
      if (!index.has(cKey)) index.set(cKey, candidate);
    }
    for (const want of keys) {
      const exact = index.get(want);
      if (exact) return exact;
      for (const [cKey, candidate] of index) {
        if (cKey.includes(want) || want.includes(cKey)) return candidate;
      }
    }
  } catch (e) {
    console.error('resolveStorageObjectPath:', e);
  }

  return null;
}

export async function createSignedPdfUrl(
  admin: SupabaseClient,
  bucket: string,
  objectPath: string,
  ttlSec: number,
  titleHint?: string | null
): Promise<{ signedUrl: string; resolvedPath: string } | null> {
  const resolved = await resolveStorageObjectPath(
    admin,
    bucket,
    objectPath,
    titleHint
  );
  if (!resolved) return null;

  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(resolved, ttlSec);
  if (error || !data?.signedUrl) {
    console.error('createSignedUrl:', error, { bucket, resolved });
    return null;
  }

  return { signedUrl: data.signedUrl, resolvedPath: resolved };
}
