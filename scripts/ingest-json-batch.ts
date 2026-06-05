/**
 * Ingest all ready JSON transcripts missing from knowledge_chunks.
 * Skips files already in DB (by metadata.source_file), not a static list.
 *
 * Usage:
 *   npm run ingest:json:batch
 *   npm run ingest:json:batch -- --force   # re-ingest all ready files
 */

import { config } from 'dotenv';
import fs from 'fs';
import { writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { fetchIngestedJsonSourceFiles } from './lib/json-ingest-db';
import { ingestJsonTranscriptFile } from './ingest-json-transcripts';

config({ path: resolve(process.cwd(), '.env') });

const root = resolve(process.cwd());
const jsonDir = join(root, 'data', 'json');
const force = process.argv.includes('--force');

function isReadyForIngest(filePath: string): boolean {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    return (
      Array.isArray(data) &&
      data.length > 0 &&
      typeof (data[0] as { video_name?: string; text?: string })?.video_name ===
        'string' &&
      typeof (data[0] as { text?: string })?.text === 'string'
    );
  } catch {
    return false;
  }
}

function rowCount(filePath: string): number {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown[];
    return Array.isArray(data)
      ? data.filter(
          (item) =>
            (item as { video_name?: string; text?: string })?.video_name?.trim() &&
            (item as { text?: string })?.text?.trim()
        ).length
      : 0;
  } catch {
    return 0;
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openai = process.env.OPENAI_API_KEY;
  if (!url || !key || !openai) {
    console.error('Missing Supabase or OPENAI_API_KEY in .env');
    process.exit(1);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const all = fs
    .readdirSync(jsonDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const ready = all.filter((f) => isReadyForIngest(join(jsonDir, f)));
  const notReady = all.filter((f) => !isReadyForIngest(join(jsonDir, f)));

  console.log('Checking DB for ingested JSON files…');
  const inDb = await fetchIngestedJsonSourceFiles(admin);

  const already = ready.filter((f) => inDb.has(f));
  const missing = force ? ready : ready.filter((f) => !inDb.has(f));

  const estChunks = missing.reduce(
    (n, f) => n + rowCount(join(jsonDir, f)),
    0
  );

  console.log(`\nJSON on disk: ${all.length} (${ready.length} ready)`);
  console.log(`Already in DB: ${already.length}`);
  console.log(`To ingest: ${missing.length} (~${estChunks} chunks)${force ? ' [force]' : ''}`);
  if (notReady.length) {
    console.log(`Not ready: ${notReady.length}`);
  }

  if (missing.length === 0) {
    console.log('\nNothing to ingest.');
    return;
  }

  const logPath = resolve(root, 'ingest-json-batch.log');
  const started = Date.now();
  let ok = 0;
  let fail = 0;
  const failures: string[] = [];

  for (let i = 0; i < missing.length; i++) {
    const file = missing[i]!;
    const rows = rowCount(join(jsonDir, file));
    const t0 = Date.now();
    console.log(`\n[${i + 1}/${missing.length}] ${file} (${rows} rows)`);

    try {
      const result = await ingestJsonTranscriptFile(file, { admin, openaiKey: openai });
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  ✓ ${result.chunkCount} chunks in ${sec}s`);
      ok++;
      writeFileSync(
        logPath,
        `${new Date().toISOString()} OK ${file} ${result.chunkCount} chunks ${sec}s\n`,
        { flag: 'a' }
      );
    } catch (e) {
      fail++;
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${file}: ${msg}`);
      console.error(`  ✗ ${msg}`);
      writeFileSync(
        logPath,
        `${new Date().toISOString()} FAIL ${file} ${msg}\n`,
        { flag: 'a' }
      );
    }
  }

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\nBatch done in ${mins} min. OK: ${ok}, failed: ${fail}`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  ${f}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
