/**
 * Find and remove duplicate PDFs in Supabase Storage (same normalized title).
 *
 *   npx tsx scripts/dedupe-storage-pdfs.ts --dry-run
 *   npx tsx scripts/dedupe-storage-pdfs.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  listBucketPdfPaths,
  normalizeStorageDedupeKey,
} from '../src/lib/rag-storage-path';

config({ path: resolve(process.cwd(), '.env') });

const BUCKET = process.env.RAG_STORAGE_BUCKET ?? 'Rag';

/** Delete knowledge_chunks only for removed storage paths */
async function deleteChunksForPaths(
  admin: ReturnType<typeof createClient>,
  paths: string[]
) {
  for (const p of paths) {
    const { count, error } = await admin
      .from('knowledge_chunks')
      .delete({ count: 'exact' })
      .contains('metadata', { storage_path: p, storage_bucket: BUCKET });
    if (error) {
      console.error(`  chunk delete failed ${p}:`, error.message);
    } else if (count && count > 0) {
      console.log(`  removed ${count} chunk(s) for ${p}`);
    }
  }
}

/** Lower score = better keeper candidate */
function keeperScore(path: string): number {
  const name = path.split('/').pop() ?? path;
  let score = 0;
  if (/\(\d+\)/.test(name)) score += 100;
  if (/\bcopy\b/i.test(name)) score += 80;
  if (/[™®©]/.test(name)) score += 20;
  if (/workshopt/i.test(name)) score += 15;
  score += name.length * 0.01;
  return score;
}

function pickKeeper(paths: string[]): string {
  return [...paths].sort((a, b) => keeperScore(a) - keeperScore(b))[0]!;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const paths = await listBucketPdfPaths(admin, BUCKET);
  console.log(`Found ${paths.length} PDF(s) in bucket "${BUCKET}".\n`);

  const groups = new Map<string, string[]>();
  for (const p of paths) {
    const key = normalizeStorageDedupeKey(p);
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }

  const dupGroups = [...groups.entries()].filter(([, ps]) => ps.length > 1);
  if (dupGroups.length === 0) {
    console.log('No duplicate PDF groups found.');
    return;
  }

  const toDelete: string[] = [];
  console.log(`${dupGroups.length} duplicate group(s):\n`);
  for (const [, ps] of dupGroups) {
    const keeper = pickKeeper(ps);
    const drops = ps.filter((p) => p !== keeper);
    console.log(`  KEEP: ${keeper}`);
    for (const d of drops) {
      console.log(`  DROP: ${d}`);
      toDelete.push(d);
    }
    console.log('');
  }

  if (toDelete.length === 0) return;

  if (dryRun) {
    console.log(`Dry run — would delete ${toDelete.length} duplicate PDF(s).`);
    return;
  }

  for (const p of toDelete) {
    const { error } = await admin.storage.from(BUCKET).remove([p]);
    if (error) {
      console.error(`  delete failed ${p}:`, error.message);
    } else {
      console.log(`  deleted ${p}`);
    }
  }

  if (toDelete.length > 0) {
    console.log('\nRemoving chunks for deleted PDFs…');
    await deleteChunksForPaths(admin, toDelete);
  }

  console.log('\nDedupe complete. Run: npm run ingest:storage:new');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
