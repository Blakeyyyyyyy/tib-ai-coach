/**
 * Remove knowledge_chunks for PDFs no longer in Storage (and rows missing storage_path).
 *
 *   npm run cleanup:storage-rag
 *   npm run cleanup:storage-rag -- --dry-run
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { cleanupOrphanKnowledgeChunks } from '../src/lib/cleanup-orphan-chunks';

config({ path: resolve(process.cwd(), '.env') });

const BUCKET = process.env.RAG_STORAGE_BUCKET ?? 'Rag';

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

  console.log(
    dryRun
      ? `Dry run — orphan chunks not in bucket "${BUCKET}"…`
      : `Removing orphan chunks not in bucket "${BUCKET}"…`
  );

  const result = await cleanupOrphanKnowledgeChunks(admin, BUCKET, { dryRun });

  if (result.orphanPaths.length === 0 && result.noPathChunkRows === 0) {
    console.log('No orphan chunks found. Database matches Storage.');
  } else {
    if (result.orphanPaths.length > 0) {
      console.log(`\n${dryRun ? 'Would remove' : 'Removed'} chunks for missing PDFs:\n`);
      for (const o of result.orphanPaths) {
        console.log(`  ${o.chunkRows} chunks — ${o.path}`);
      }
    }
    if (result.noPathChunkRows > 0) {
      console.log(
        `\n${result.noPathChunkRows} chunk(s) with no storage_path in metadata ${dryRun ? 'would be' : ''} removed.`
      );
    }
    if (!dryRun) {
      console.log(`\nDeleted ${result.deletedChunkRows} chunk row(s) total.`);
    }
  }

  console.log(`\nKept ${result.keptChunkRows} chunk row(s) tied to PDFs still in Storage. Done.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
