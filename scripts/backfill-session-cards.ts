/**
 * Add one session-card embedding per JSON transcript and PDF (no full re-ingest).
 *
 * Usage: npm run ingest:session-cards
 */

import { config } from 'dotenv';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { upsertPdfSessionCard, upsertVideoSessionCard } from '../src/lib/ai/upsert-session-card';
import { resolveTranscriptSessionTitle } from '../src/lib/transcript-display-title';
import { listBucketPdfPaths } from '../src/lib/rag-storage-path';

config({ path: resolve(process.cwd(), '.env') });

const BUCKET = process.env.RAG_STORAGE_BUCKET ?? 'Rag';
const JSON_DIR = resolve(process.cwd(), 'data', 'json');

function displayPdfTitle(filename: string): string {
  return filename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openai = process.env.OPENAI_API_KEY;
  if (!url || !key || !openai) {
    console.error('Missing env');
    process.exit(1);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const jsonFiles = readdirSync(JSON_DIR).filter((f) => f.endsWith('.json'));
  console.log(`JSON session cards: ${jsonFiles.length} files\n`);

  let jsonOk = 0;
  for (const file of jsonFiles) {
    try {
      const raw = readFileSync(join(JSON_DIR, file), 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      const valid = parsed.filter(
        (item: { video_name?: string; text?: string }) =>
          item?.video_name?.trim() && item?.text?.trim()
      );
      if (!valid.length) continue;

      const sessionTitle = resolveTranscriptSessionTitle(
        file,
        valid[0]!.video_name.trim()
      );
      const videoUrl =
        typeof valid[0]!.video_url === 'string' ? valid[0]!.video_url.trim() : null;

      await upsertVideoSessionCard(admin, openai, {
        sessionTitle,
        sourceFile: file,
        videoName: valid[0]!.video_name.trim(),
        videoUrl: videoUrl && !videoUrl.includes('example.com') ? videoUrl : null,
        segmentTexts: valid.slice(0, 40).map((v: { text: string }) => v.text),
      });
      jsonOk++;
      process.stdout.write(`  ${file}\r`);
    } catch (e) {
      console.error(`\n  FAIL ${file}:`, e);
    }
  }
  console.log(`\nJSON: ${jsonOk}/${jsonFiles.length} session cards`);

  const pdfPaths = await listBucketPdfPaths(admin, BUCKET);
  console.log(`\nPDF session cards: ${pdfPaths.length} files\n`);

  let pdfOk = 0;
  for (const objectPath of pdfPaths) {
    try {
      const title = displayPdfTitle(objectPath.split('/').pop() || objectPath);
      const { data: sample } = await admin
        .from('knowledge_chunks')
        .select('content')
        .contains('metadata', { storage_path: objectPath, storage_bucket: BUCKET })
        .limit(8);

      const texts = (sample ?? [])
        .map((r) => r.content?.replace(/^Document:[^\n]*\n\n/i, '') ?? '')
        .filter((t) => t.length > 40);

      if (!texts.length) {
        console.log(`  skip (no chunks): ${objectPath}`);
        continue;
      }

      await upsertPdfSessionCard(admin, openai, {
        title,
        storagePath: objectPath,
        bucket: BUCKET,
        chunkTexts: texts,
      });
      pdfOk++;
    } catch (e) {
      console.error(`  FAIL ${objectPath}:`, e);
    }
  }

  console.log(`\nPDF: ${pdfOk}/${pdfPaths.length} session cards`);
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
