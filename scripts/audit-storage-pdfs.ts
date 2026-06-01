import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  listBucketPdfPaths,
  normalizeStorageMatchKey,
} from '../src/lib/rag-storage-path';

config({ path: resolve(process.cwd(), '.env') });

const BUCKET = process.env.RAG_STORAGE_BUCKET ?? 'Rag';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) process.exit(1);

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const paths = await listBucketPdfPaths(admin, BUCKET);
  const pathSet = new Set(paths);

  const { data: rows } = await admin
    .from('knowledge_chunks')
    .select('metadata, source_title')
    .contains('metadata', { storage_bucket: BUCKET });

  const chunkedPaths = new Map<string, number>();
  const titleToPaths = new Map<string, Set<string>>();

  for (const row of rows || []) {
    const meta = row.metadata as Record<string, unknown> | null;
    const p = typeof meta?.storage_path === 'string' ? meta.storage_path : null;
    if (p) {
      chunkedPaths.set(p, (chunkedPaths.get(p) ?? 0) + 1);
      const t = normalizeStorageMatchKey(p);
      const set = titleToPaths.get(t) ?? new Set();
      set.add(p);
      titleToPaths.set(t, set);
    }
  }

  const notIngested = paths.filter((p) => !chunkedPaths.has(p));
  const orphanChunkPaths = [...chunkedPaths.keys()].filter((p) => !pathSet.has(p));
  const multiPathTitles = [...titleToPaths.entries()].filter(([, s]) => s.size > 1);

  console.log(`Storage PDFs: ${paths.length}`);
  console.log(`Chunked paths: ${chunkedPaths.size}`);
  console.log(`Not yet ingested: ${notIngested.length}`);
  console.log(`Orphan chunk paths (not in storage): ${orphanChunkPaths.length}`);
  console.log(`Titles with multiple storage paths in DB: ${multiPathTitles.length}`);

  if (notIngested.length) {
    console.log('\n--- NOT INGESTED ---');
    for (const p of notIngested.sort()) console.log(p);
  }

  if (orphanChunkPaths.length) {
    console.log('\n--- ORPHAN CHUNK PATHS ---');
    for (const p of orphanChunkPaths.sort()) console.log(`${p} (${chunkedPaths.get(p)} chunks)`);
  }

  if (multiPathTitles.length) {
    console.log('\n--- MULTI-PATH TITLES (dual in DB) ---');
    for (const [t, ps] of multiPathTitles) {
      console.log(`\n${t}:`);
      for (const p of ps) console.log(`  ${p} (${chunkedPaths.get(p)} chunks)`);
    }
  }

  // fuzzy duplicate check: very similar normalized keys
  const keys = paths.map((p) => ({ p, k: normalizeStorageMatchKey(p) }));
  console.log('\n--- SIMILAR NAMES (Levenshtein-ish prefix) ---');
  let found = 0;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i]!;
      const b = keys[j]!;
      if (a.k === b.k) continue;
      const shorter = a.k.length < b.k.length ? a.k : b.k;
      const longer = a.k.length >= b.k.length ? a.k : b.k;
      if (shorter.length > 20 && longer.includes(shorter.slice(0, Math.min(30, shorter.length)))) {
        console.log(`  ${a.p}`);
        console.log(`  ${b.p}\n`);
        found++;
      }
    }
  }
  if (!found) console.log('  (none)');
}

main().catch(console.error);
