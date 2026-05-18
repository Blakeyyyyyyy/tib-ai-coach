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

config({ path: resolve(process.cwd(), '.env') });

const BUCKET = process.env.RAG_STORAGE_BUCKET ?? 'Rag';
const CHUNK_SIZE = 2200;
const CHUNK_OVERLAP = 200;
const EMBED_BATCH = 24;

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

async function listPdfPaths(
  client: SupabaseClient,
  prefix: string
): Promise<string[]> {
  const { data, error } = await client.storage.from(BUCKET).list(prefix, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  });
  if (error) throw error;
  const out: string[] = [];
  for (const item of data || []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.metadata === null) {
      out.push(...(await listPdfPaths(client, path)));
    } else if (item.name.toLowerCase().endsWith('.pdf')) {
      out.push(path);
    }
  }
  return out;
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

  const paths = await listPdfPaths(admin, '');
  if (paths.length === 0) {
    console.log(`No PDFs found in bucket "${BUCKET}".`);
    return;
  }

  console.log(`Found ${paths.length} PDF(s) in "${BUCKET}".`);

  for (const objectPath of paths) {
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
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      console.log('  no extractable text, skip');
      continue;
    }

    const { error: delErr } = await admin
      .from('knowledge_chunks')
      .delete()
      .contains('metadata', { storage_path: objectPath, storage_bucket: BUCKET });
    if (delErr) {
      console.error('  delete old chunks:', delErr.message);
    }

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
