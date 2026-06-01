/**
 * Ingest PDFs from a Supabase Storage bucket into knowledge_chunks (pgvector).
 *
 * Required env (in project root .env):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 * Optional:
 *   RAG_STORAGE_BUCKET (default: Rag)
 *
 * Run from repo root: npm run ingest:storage
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { embedTexts } from '../src/lib/ai/openai-embed';
import { healStaleStoragePaths } from '../src/lib/heal-storage-paths';
import {
  listBucketPdfPaths,
  normalizeStorageMatchKey,
} from '../src/lib/rag-storage-path';

config({ path: resolve(process.cwd(), '.env') });

const BUCKET = process.env.RAG_STORAGE_BUCKET ?? 'Rag';
/** ~250 tokens — better for exact quotes and precise PDF matching */
const CHUNK_SIZE = parseInt(process.env.RAG_CHUNK_SIZE ?? '1000', 10) || 1000;
const CHUNK_OVERLAP = parseInt(process.env.RAG_CHUNK_OVERLAP ?? '200', 10) || 200;
const EMBED_BATCH = 24;

function formatChunkForStorage(documentTitle: string, body: string): string {
  return `Document: ${documentTitle}\n\n${body.trim()}`;
}

function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + CHUNK_SIZE, normalized.length);
    let slice = normalized.slice(start, end);
    if (end < normalized.length) {
      const lastPara = slice.lastIndexOf('\n\n');
      if (lastPara > CHUNK_SIZE * 0.4) {
        slice = slice.slice(0, lastPara).trimEnd();
      }
    }
    if (slice.trim().length > 80) {
      chunks.push(slice.trim());
    }
    const next = end - CHUNK_OVERLAP;
    start = next <= start ? end : next;
  }
  return chunks;
}

function displayTitle(filename: string): string {
  const base = filename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
  return base.replace(/\s+/g, ' ').trim() || filename;
}

/** Remove chunks for this PDF and any stale paths (e.g. old ™ filename) for the same document. */
async function deleteChunksForPdf(
  admin: SupabaseClient,
  canonicalPath: string
) {
  const norm = normalizeStorageMatchKey(canonicalPath);
  const paths = new Set<string>([canonicalPath]);

  const { data: rows } = await admin
    .from('knowledge_chunks')
    .select('metadata')
    .contains('metadata', { storage_bucket: BUCKET });

  for (const row of rows || []) {
    const meta = row.metadata as Record<string, unknown> | null;
    const p =
      typeof meta?.storage_path === 'string' ? meta.storage_path.trim() : '';
    if (p && normalizeStorageMatchKey(p) === norm) paths.add(p);
  }

  for (const p of paths) {
    const { error } = await admin
      .from('knowledge_chunks')
      .delete()
      .contains('metadata', { storage_path: p, storage_bucket: BUCKET });
    if (error) console.error('  delete old chunks:', p, error.message);
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openai = process.env.OPENAI_API_KEY;
  if (!url || !key || !openai) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or OPENAI_API_KEY');
    process.exit(1);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log('Checking for stale storage_path metadata (™ renames, etc.)…');
  const heal = await healStaleStoragePaths(admin, BUCKET);
  if (heal.healed.length > 0) {
    for (const h of heal.healed) {
      console.log(`  healed ${h.chunkRows} chunks: ${h.from} → ${h.to}`);
    }
  }

  const paths = await listBucketPdfPaths(admin, BUCKET);
  if (paths.length === 0) {
    console.log(`No PDFs found in bucket "${BUCKET}".`);
    return;
  }

  const newOnly = process.argv.includes('--new-only');
  let toIngest = paths;

  if (newOnly) {
    const { data: existing } = await admin
      .from('knowledge_chunks')
      .select('metadata')
      .contains('metadata', { storage_bucket: BUCKET });

    const ingested = new Set<string>();
    for (const row of existing || []) {
      const meta = row.metadata as Record<string, unknown> | null;
      const p =
        typeof meta?.storage_path === 'string' ? meta.storage_path.trim() : '';
      if (p) ingested.add(p);
    }

    toIngest = paths.filter((p) => !ingested.has(p));
    console.log(
      `\nNew-only: ${toIngest.length} PDF(s) to ingest (${paths.length - toIngest.length} already in DB).`
    );
    if (toIngest.length === 0) {
      console.log('Nothing new to ingest.');
      return;
    }
  } else {
    console.log(`\nFound ${paths.length} PDF(s) in "${BUCKET}".`);
  }

  for (const objectPath of toIngest) {
    const title = displayTitle(objectPath.split('/').pop() || objectPath);
    console.log(`\n→ ${objectPath}`);

    const { data: file, error: dlErr } = await admin.storage
      .from(BUCKET)
      .download(objectPath);
    if (dlErr || !file) {
      console.error('  download failed:', dlErr?.message ?? 'no file');
      continue;
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const pdfParse = (await import('pdf-parse')).default as (
      b: Buffer
    ) => Promise<{ text: string }>;
    const { text } = await pdfParse(buf);
    const rawChunks = chunkText(text);
    const chunks = rawChunks.map((c) => formatChunkForStorage(title, c));
    if (chunks.length === 0) {
      console.log('  no extractable text, skip');
      continue;
    }

    await deleteChunksForPdf(admin, objectPath);

    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const embeddings = await embedTexts(batch, openai);
      const rows = batch.map((content, j) => ({
        content,
        embedding: embeddings[j] as unknown as number[],
        source_title: title,
        source_url: null as string | null,
        resource_url: null as string | null,
        metadata: {
          storage_bucket: BUCKET,
          storage_path: objectPath,
          chunk_index: i + j,
        },
      }));

      const { error: insErr } = await admin.from('knowledge_chunks').insert(rows);
      if (insErr) {
        console.error('  insert error:', insErr.message);
        process.exit(1);
      }
      process.stdout.write(`  embedded ${Math.min(i + EMBED_BATCH, chunks.length)}/${chunks.length}\r`);
    }
    console.log(`  done: ${chunks.length} chunks`);
  }

  console.log('\nIngest complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
