/**
 * Sample DB rows for legacy Momentum JSON files — check new ingest metadata.
 * Usage: npx tsx scripts/inspect-momentum-legacy-db.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env') });

const LEGACY = [
  'momentum_meet.json',
  'momentum_meet_1143260246.json',
  'momentum_meet_1136289171.json',
  'momentum_meet_1133307969.json',
];

async function countChunksForFile(
  admin: ReturnType<typeof createClient>,
  file: string
): Promise<number> {
  const { count, error } = await admin
    .from('knowledge_chunks')
    .select('id', { count: 'exact', head: true })
    .contains('metadata', { source_file: file });
  if (error) throw error;
  return count ?? 0;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing Supabase env');
    process.exit(1);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log('Legacy Momentum Meet — DB sample\n');

  let total = 0;
  for (const file of LEGACY) {
    total += await countChunksForFile(admin, file);
  }
  console.log(`Total chunks (4 files): ${total} (expected 794, one row per transcript segment)\n`);

  for (const file of LEGACY) {
    const { data, error, count } = await admin
      .from('knowledge_chunks')
      .select('id, source_title, source_url, content, metadata', {
        count: 'exact',
      })
      .contains('metadata', { source_file: file })
      .limit(1);

    if (error) {
      console.log(`→ ${file}: ERROR ${error.message}\n`);
      continue;
    }

    const row = data?.[0];
    if (!row) {
      console.log(`→ ${file}: NOT IN DB (0 chunks)\n`);
      continue;
    }

    const meta = row.metadata as Record<string, unknown> | null;
    const contentHead = String(row.content ?? '').slice(0, 80).replace(/\n/g, ' ');

    console.log(`→ ${file} (${count ?? '?'} chunks total)`);
    console.log(`  source_title: ${row.source_title}`);
    console.log(`  source_url: ${row.source_url ?? '(null)'}`);
    console.log(`  metadata.video_url: ${meta?.video_url ?? '(missing)'}`);
    console.log(`  metadata.session_display_title: ${meta?.session_display_title ?? '(missing)'}`);
    console.log(`  metadata.has_video_url: ${meta?.has_video_url ?? '(missing)'}`);
    console.log(`  metadata.video_name: ${meta?.video_name ?? '(missing)'}`);
    console.log(`  content starts: ${contentHead}…`);
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
