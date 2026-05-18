import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createSignedPdfUrl } from '@/lib/rag-storage-path';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SIGNED_TTL = 60 * 60; // 1h — user lands on Supabase URL after redirect

function coerceMeta(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      const o = JSON.parse(raw) as unknown;
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        return o as Record<string, unknown>;
      }
    } catch {
      return null;
    }
    return null;
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

function firstMetaString(meta: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** Resolve Storage object key inside the bucket (ingest uses storage_path; legacy rows may use filename). */
function resolveStorageObjectPath(meta: Record<string, unknown>): string {
  return firstMetaString(meta, [
    'storage_path',
    'storagePath',
    'object_path',
    'objectPath',
    'path',
    'file_path',
    'filepath',
    'filename',
    'file',
  ]);
}

export async function GET(request: NextRequest) {
  const chunkId = request.nextUrl.searchParams.get('chunk_id')?.trim();
  if (!chunkId || !UUID_RE.test(chunkId)) {
    return NextResponse.json({ error: 'Invalid chunk_id' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const { data: row, error } = await admin
    .from('knowledge_chunks')
    .select('metadata, source_title')
    .eq('id', chunkId)
    .maybeSingle();

  if (error) {
    console.error('knowledge_chunks select:', error);
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const meta = coerceMeta(row?.metadata);
  if (!meta) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const bucket =
    firstMetaString(meta, ['storage_bucket', 'storageBucket', 'bucket']) ||
    process.env.RAG_STORAGE_BUCKET ||
    'Rag';

  const objectPath = resolveStorageObjectPath(meta);
  if (!objectPath) {
    return NextResponse.json(
      {
        error: 'No storage path',
        hint:
          'This chunk has no file path in metadata (e.g. storage_path or filename). Re-run: npm run ingest:storage',
      },
      { status: 404 }
    );
  }

  const resolved = await createSignedPdfUrl(
    admin,
    bucket,
    objectPath,
    SIGNED_TTL,
    row?.source_title
  );

  if (!resolved) {
    console.error('createSignedPdfUrl failed', {
      bucket,
      objectPath,
      source_title: row?.source_title,
    });
    return NextResponse.json(
      {
        error: 'Could not open file',
        hint:
          'The PDF may have been renamed or removed from Storage. Check the Rag bucket for this file, then run: npm run ingest:storage',
      },
      { status: 502 }
    );
  }

  if (resolved.resolvedPath !== objectPath) {
    console.warn('PDF path resolved via fallback', {
      stored: objectPath,
      resolved: resolved.resolvedPath,
    });
    // Self-heal chunk metadata after Storage rename (e.g. ™ removed from filename)
    const { error: healErr } = await admin
      .from('knowledge_chunks')
      .update({
        metadata: {
          ...meta,
          storage_bucket: bucket,
          storage_path: resolved.resolvedPath,
        },
      })
      .contains('metadata', {
        storage_path: objectPath,
        storage_bucket: bucket,
      });
    if (healErr) {
      console.warn('knowledge_chunks metadata heal:', healErr.message);
    }
  }

  return NextResponse.redirect(resolved.signedUrl);
}
