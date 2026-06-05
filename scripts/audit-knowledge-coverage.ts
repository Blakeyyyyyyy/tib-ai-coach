/**
 * Compare Storage PDFs + data/json transcripts vs knowledge_chunks in DB.
 *
 * Usage: npm run audit:knowledge
 */

import { config } from 'dotenv';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  listBucketPdfPaths,
  normalizeStorageMatchKey,
} from '../src/lib/rag-storage-path';

config({ path: resolve(process.cwd(), '.env') });

const BUCKET = process.env.RAG_STORAGE_BUCKET ?? 'Rag';
const JSON_DIR = resolve(process.cwd(), 'data', 'json');
const PAGE = 1000;

type JsonFileInfo = {
  file: string;
  ready: boolean;
  rows: number;
};

function isJsonReady(path: string): { ready: boolean; rows: number } {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return { ready: false, rows: 0 };
    const rows = parsed.filter(
      (item: { video_name?: string; text?: string }) =>
        item?.video_name?.trim() && item?.text?.trim()
    ).length;
    return { ready: rows > 0, rows };
  } catch {
    return { ready: false, rows: 0 };
  }
}

async function fetchAllChunkMeta(admin: ReturnType<typeof createClient>) {
  const pdfPaths = new Map<string, number>();
  const jsonFiles = new Map<string, number>();
  const videoTitles = new Map<string, number>();
  let offset = 0;
  let total = 0;

  for (;;) {
    const { data, error } = await admin
      .from('knowledge_chunks')
      .select('metadata, source_title')
      .range(offset, offset + PAGE - 1);

    if (error) throw new Error(error.message);
    if (!data?.length) break;

    for (const row of data) {
      total++;
      const meta = row.metadata as Record<string, unknown> | null;
      const st = typeof meta?.source_type === 'string' ? meta.source_type : '';
      const sf = typeof meta?.source_file === 'string' ? meta.source_file.trim() : '';
      const sp =
        typeof meta?.storage_path === 'string' ? meta.storage_path.trim() : '';
      const bucket =
        typeof meta?.storage_bucket === 'string' ? meta.storage_bucket : '';

      if (sf && (st === 'video_transcript' || row.source_title?.startsWith('Video'))) {
        jsonFiles.set(sf, (jsonFiles.get(sf) ?? 0) + 1);
      } else if (bucket === BUCKET && sp) {
        pdfPaths.set(sp, (pdfPaths.get(sp) ?? 0) + 1);
      }

      const title = row.source_title?.trim();
      if (title) {
        videoTitles.set(title, (videoTitles.get(title) ?? 0) + 1);
      }
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return { pdfPaths, jsonFiles, videoTitles, total };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing Supabase env vars');
    process.exit(1);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const storagePdfs = await listBucketPdfPaths(admin, BUCKET);
  const jsonOnDisk = readdirSync(JSON_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const jsonFiles: JsonFileInfo[] = jsonOnDisk.map((file) => {
    const { ready, rows } = isJsonReady(join(JSON_DIR, file));
    return { file, ready, rows };
  });

  console.log('Loading knowledge_chunks metadata…');
  const { pdfPaths, jsonFiles: jsonInDb, total } = await fetchAllChunkMeta(admin);

  const pdfMissing = storagePdfs.filter((p) => !pdfPaths.has(p));
  const pdfOrphan = [...pdfPaths.keys()].filter(
    (p) => !storagePdfs.includes(p)
  );

  const jsonReady = jsonFiles.filter((j) => j.ready);
  const jsonNotReady = jsonFiles.filter((j) => !j.ready);
  const jsonMissing = jsonReady.filter((j) => !jsonInDb.has(j.file));
  const jsonInDbNotOnDisk = [...jsonInDb.keys()].filter(
    (f) => !jsonOnDisk.includes(f)
  );

  const reportPath = resolve(process.cwd(), 'audit-knowledge-report.txt');
  const lines: string[] = [
    `Knowledge coverage audit — ${new Date().toISOString()}`,
    '',
    '=== SUMMARY ===',
    `Total chunks in DB: ${total}`,
    '',
    'PDFs (Supabase Storage)',
    `  In bucket "${BUCKET}": ${storagePdfs.length}`,
    `  With chunks in DB: ${pdfPaths.size}`,
    `  Missing from DB: ${pdfMissing.length}`,
    `  Orphan chunk paths (in DB, not in storage): ${pdfOrphan.length}`,
    '',
    'JSON transcripts (data/json)',
    `  Files on disk: ${jsonOnDisk.length}`,
    `  Ready to ingest (valid rows): ${jsonReady.length}`,
    `  Not ready (empty/invalid): ${jsonNotReady.length}`,
    `  Ingested (source_file in DB): ${jsonInDb.size}`,
    `  Ready but MISSING from DB: ${jsonMissing.length}`,
    `  In DB but file removed from disk: ${jsonInDbNotOnDisk.length}`,
  ];

  if (pdfMissing.length) {
    lines.push('', '=== PDFs NOT IN DB ===');
    for (const p of pdfMissing.sort()) lines.push(p);
  }

  if (pdfOrphan.length) {
    lines.push('', '=== ORPHAN PDF CHUNK PATHS ===');
    for (const p of pdfOrphan.sort()) {
      lines.push(`${p} (${pdfPaths.get(p)} chunks)`);
    }
  }

  const jsonInDbList = jsonReady
    .filter((j) => jsonInDb.has(j.file))
    .map((j) => `${j.file} (${jsonInDb.get(j.file)} chunks, ${j.rows} rows on disk)`);

  if (jsonInDbList.length) {
    lines.push('', '=== JSON IN DB ===');
    for (const line of jsonInDbList.sort()) lines.push(line);
  }

  if (jsonMissing.length) {
    lines.push('', '=== JSON READY BUT NOT IN DB ===');
    for (const j of jsonMissing) {
      lines.push(`${j.file} (${j.rows} transcript rows)`);
    }
  }

  if (jsonNotReady.length) {
    lines.push('', '=== JSON NOT READY (need prepare:json) ===');
    for (const j of jsonNotReady) lines.push(j.file);
  }

  if (jsonInDbNotOnDisk.length) {
    lines.push('', '=== JSON IN DB BUT FILE MISSING ON DISK ===');
    for (const f of jsonInDbNotOnDisk.sort()) {
      lines.push(`${f} (${jsonInDb.get(f)} chunks)`);
    }
  }

  const ingestedNotReady = jsonOnDisk.filter(
    (f) => jsonInDb.has(f) && !jsonFiles.find((j) => j.file === f)?.ready
  );
  if (ingestedNotReady.length) {
    lines.push('', '=== IN DB BUT MARKED NOT READY ON DISK ===');
    for (const f of ingestedNotReady) lines.push(f);
  }

  const report = lines.join('\n');
  console.log('\n' + report);
  writeFileSync(reportPath, report, 'utf8');
  console.log(`\nReport saved: ${reportPath}`);

  if (pdfMissing.length || jsonMissing.length) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
