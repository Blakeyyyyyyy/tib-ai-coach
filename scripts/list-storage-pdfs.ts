import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  listBucketPdfPaths,
  normalizeStorageDedupeKey,
  normalizeStorageMatchKey,
} from '../src/lib/rag-storage-path';

config({ path: resolve(process.cwd(), '.env') });

const BUCKET = process.env.RAG_STORAGE_BUCKET ?? 'Rag';

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const paths = await listBucketPdfPaths(admin, BUCKET);
  console.log(`Total PDFs: ${paths.length}\n`);

  const byDedupe = new Map<string, string[]>();
  for (const p of paths) {
    const k = normalizeStorageDedupeKey(p);
    const list = byDedupe.get(k) ?? [];
    list.push(p);
    byDedupe.set(k, list);
  }

  const dups = [...byDedupe.entries()].filter(([, ps]) => ps.length > 1);
  if (dups.length) {
    console.log('DUPLICATE GROUPS (dedupe key):');
    for (const [, ps] of dups) {
      for (const p of ps) console.log(`  ${p}`);
      console.log('');
    }
  } else {
    console.log('No duplicate groups (dedupe key).\n');
  }

  // Near-duplicates: same key after stripping -copy, -Copy, _copy
  const stripCopy = (s: string) =>
    normalizeStorageMatchKey(
      s.replace(/\s*[-_]?\s*copy\s*(\(\d+\))?\.pdf$/i, '.pdf')
    );
  const byCopy = new Map<string, string[]>();
  for (const p of paths) {
    const k = stripCopy(p);
    const list = byCopy.get(k) ?? [];
    list.push(p);
    byCopy.set(k, list);
  }
  const copyDups = [...byCopy.entries()].filter(([, ps]) => ps.length > 1);
  if (copyDups.length) {
    console.log('NEAR-DUPLICATES (copy suffix):');
    for (const [, ps] of copyDups) {
      for (const p of ps) console.log(`  ${p}`);
      console.log('');
    }
  }

  console.log('ALL FILES (sorted):');
  for (const p of [...paths].sort()) console.log(p);
}

main().catch(console.error);
