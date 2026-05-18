/**
 * Bulk-fix knowledge_chunks storage_path when Storage filenames changed
 * (e.g. ™ removed). Safe to run anytime; does not re-embed.
 *
 *   npm run heal:storage-paths
 *   npm run heal:storage-paths -- --dry-run
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { healStaleStoragePaths } from '../src/lib/heal-storage-paths';

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
      ? `Dry run — checking bucket "${BUCKET}" vs knowledge_chunks…`
      : `Healing stale storage_path values in bucket "${BUCKET}"…`
  );

  const result = await healStaleStoragePaths(admin, BUCKET, { dryRun });

  if (result.healed.length === 0) {
    console.log('No stale paths found (all chunk paths match Storage).');
  } else {
    console.log(`\n${dryRun ? 'Would heal' : 'Healed'} ${result.healed.length} path(s):\n`);
    for (const h of result.healed) {
      const tm =
        /™|®|©/.test(h.from) && !/™|®|©/.test(h.to)
          ? ' (™/mark removed in Storage)'
          : '';
      console.log(`  ${h.chunkRows} chunks`);
      console.log(`    from: ${h.from}`);
      console.log(`    to:   ${h.to}${tm}\n`);
    }
  }

  if (result.missing.length > 0) {
    console.log('No Storage match (check bucket or re-ingest):');
    for (const p of result.missing) console.log(`  - ${p}`);
  }

  console.log(`\n${result.okPaths} PDF(s) in Storage. Done.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
