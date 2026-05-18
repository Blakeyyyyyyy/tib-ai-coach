import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
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
    .select('metadata')
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

  const { data: signed, error: signErr } = await admin.storage
    .from(bucket)
    .createSignedUrl(objectPath, SIGNED_TTL);

  if (signErr || !signed?.signedUrl) {
    console.error('createSignedUrl:', signErr, { bucket, objectPath });
    return NextResponse.json({ error: 'Could not open file' }, { status: 502 });
  }

  return NextResponse.redirect(signed.signedUrl);
}
