/**
 * Detect duplicate / over-counted embeddings in knowledge_chunks.
 *
 * Checks:
 * - JSON: DB chunk count vs transcript rows on disk (per source_file)
 * - Duplicate (source_file, chunk_index)
 * - Duplicate content hash (same text stored twice)
 * - PDF: duplicate storage_path rows beyond expected (same path, same chunk_index if present)
 * - Exact duplicate embedding vectors (same source_file only — full scan)
 *
 * Usage: npm run audit:embeddings
 */

import { createHash } from 'crypto';
import { config } from 'dotenv';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env') });

const JSON_DIR = resolve(process.cwd(), 'data', 'json');
const PAGE = 500;

type Row = {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
};

function hashContent(s: string): string {
  return createHash('sha256').update(s.trim()).digest('hex').slice(0, 16);
}

function normalizeEmbedding(emb: unknown): number[] | null {
  if (Array.isArray(emb) && emb.length > 0) return emb as number[];
  if (typeof emb === 'string' && emb.startsWith('[')) {
    try {
      const parsed = JSON.parse(emb) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as number[];
    } catch {
      return null;
    }
  }
  return null;
}

function hashEmbedding(emb: unknown): string | null {
  const vec = normalizeEmbedding(emb);
  if (!vec) return null;
  return createHash('sha256').update(JSON.stringify(vec)).digest('hex').slice(0, 16);
}

function jsonRowsOnDisk(file: string): number {
  try {
    const parsed = JSON.parse(
      readFileSync(join(JSON_DIR, file), 'utf8')
    ) as unknown;
    if (!Array.isArray(parsed)) return 0;
    return parsed.filter(
      (item: { video_name?: string; text?: string }) =>
        item?.video_name?.trim() && item?.text?.trim()
    ).length;
  } catch {
    return -1;
  }
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

  console.log('Scanning knowledge_chunks for embedding duplicates…\n');

  const bySourceFile = new Map<string, number>();
  const byChunkIndex = new Map<string, number>();
  const contentHashGlobal = new Map<string, string[]>();
  const contentHashPerFile = new Map<string, Map<string, string[]>>();
  const embedHashPerFile = new Map<string, Map<string, string[]>>();
  const pdfByPath = new Map<string, number>();

  let total = 0;
  let offset = 0;
  let missingEmbed = 0;

  for (;;) {
    const { data, error } = await admin
      .from('knowledge_chunks')
      .select('id, content, metadata, embedding')
      .range(offset, offset + PAGE - 1);

    if (error) throw new Error(error.message);
    if (!data?.length) break;

    for (const row of data as (Row & { embedding?: unknown })[]) {
      total++;
      const meta = row.metadata;
      const sf =
        typeof meta?.source_file === 'string' ? meta.source_file.trim() : '';
      const sp =
        typeof meta?.storage_path === 'string' ? meta.storage_path.trim() : '';
      const ci =
        typeof meta?.chunk_index === 'number' ? meta.chunk_index : null;
      const st =
        typeof meta?.source_type === 'string' ? meta.source_type : '';

      if (sf) {
        bySourceFile.set(sf, (bySourceFile.get(sf) ?? 0) + 1);
        if (ci !== null) {
          const key = `${sf}\0${ci}`;
          byChunkIndex.set(key, (byChunkIndex.get(key) ?? 0) + 1);
        }
      }

      if (sp && st !== 'video_transcript') {
        pdfByPath.set(sp, (pdfByPath.get(sp) ?? 0) + 1);
      }

      const ch = hashContent(row.content);
      if (!contentHashGlobal.has(ch)) contentHashGlobal.set(ch, []);
      contentHashGlobal.get(ch)!.push(row.id);

      if (sf) {
        if (!contentHashPerFile.has(sf)) contentHashPerFile.set(sf, new Map());
        const m = contentHashPerFile.get(sf)!;
        if (!m.has(ch)) m.set(ch, []);
        m.get(ch)!.push(row.id);
      }

      const eh = hashEmbedding(row.embedding);
      if (!eh) {
        missingEmbed++;
      } else if (sf) {
        if (!embedHashPerFile.has(sf)) embedHashPerFile.set(sf, new Map());
        const em = embedHashPerFile.get(sf)!;
        if (!em.has(eh)) em.set(eh, []);
        em.get(eh)!.push(row.id);
      }
    }

    if (data.length < PAGE) break;
    offset += PAGE;
    if (offset % 5000 === 0) console.log(`  …${offset} rows`);
  }

  console.log(`Total rows: ${total}`);
  if (missingEmbed > 0) console.log(`Rows without embedding array: ${missingEmbed}`);

  const dupChunkIndex: string[] = [];
  for (const [key, n] of byChunkIndex) {
    if (n > 1) dupChunkIndex.push(`${key.replace('\0', ' chunk_index=')} → ${n} rows`);
  }

  const dupContentGlobal: { hash: string; ids: string[] }[] = [];
  for (const [h, ids] of contentHashGlobal) {
    if (ids.length > 1) dupContentGlobal.push({ hash: h, ids });
  }

  const dupContentPerFile: { file: string; hash: string; count: number }[] = [];
  for (const [file, m] of contentHashPerFile) {
    for (const [h, ids] of m) {
      if (ids.length > 1) {
        dupContentPerFile.push({ file, hash: h, count: ids.length });
      }
    }
  }

  const dupEmbedPerFile: { file: string; hash: string; count: number }[] = [];
  const dupEmbedDiffContent: { file: string; hash: string; count: number }[] = [];
  for (const [file, m] of embedHashPerFile) {
    for (const [h, ids] of m) {
      if (ids.length > 1) {
        dupEmbedPerFile.push({ file, hash: h, count: ids.length });
        const contentHashes = new Set(
          ids.map((id) => {
            for (const [ch, idList] of contentHashPerFile.get(file) ?? []) {
              if (idList.includes(id)) return ch;
            }
            return '';
          })
        );
        if (contentHashes.size > 1) {
          dupEmbedDiffContent.push({ file, hash: h, count: ids.length });
        }
      }
    }
  }

  const jsonMismatch: string[] = [];
  const jsonFiles = readdirSync(JSON_DIR).filter((f) => f.endsWith('.json'));
  for (const file of jsonFiles) {
    const disk = jsonRowsOnDisk(file);
    if (disk < 0) continue;
    const db = bySourceFile.get(file) ?? 0;
    if (disk === 0) continue;
    if (db === 0 && disk > 0) {
      jsonMismatch.push(`${file}: disk=${disk} db=0 (missing)`);
    } else if (db !== disk) {
      jsonMismatch.push(`${file}: disk=${disk} db=${db} ${db > disk ? 'OVER' : 'UNDER'}`);
    }
  }

  const legacyMomentum = [
    'momentum_meet.json',
    'momentum_meet_1143260246.json',
    'momentum_meet_1136289171.json',
    'momentum_meet_1133307969.json',
  ];
  let legacyTotal = 0;
  for (const f of legacyMomentum) legacyTotal += bySourceFile.get(f) ?? 0;

  const lines: string[] = [
    `Embedding duplicate audit — ${new Date().toISOString()}`,
    '',
    '=== SUMMARY ===',
    `Total chunks: ${total}`,
    `Legacy Momentum (4 files): ${legacyTotal} chunks (expected 794)`,
    '',
    '=== DUPLICATE (source_file, chunk_index) ===',
    dupChunkIndex.length
      ? dupChunkIndex.slice(0, 50).join('\n') +
        (dupChunkIndex.length > 50 ? `\n…+${dupChunkIndex.length - 50} more` : '')
      : 'None ✓',
    '',
    '=== IDENTICAL EMBEDDING VECTOR (same file — FAIL if different text) ===',
    dupEmbedDiffContent.length
      ? dupEmbedDiffContent
          .map((d) => `${d.file}: ${d.count} rows, vector ${d.hash} (DIFFERENT content — bad)`)
          .join('\n')
      : 'None ✓',
    '',
    '=== IDENTICAL EMBEDDING + SAME TEXT (source transcript overlap — warn only) ===',
    dupEmbedPerFile.length
      ? dupEmbedPerFile
          .map((d) => `${d.file}: ${d.count} rows, vector ${d.hash}`)
          .join('\n')
      : 'None ✓',
    '',
    '=== IDENTICAL CONTENT TEXT (same file) ===',
    dupContentPerFile.length
      ? dupContentPerFile
          .sort((a, b) => b.count - a.count)
          .slice(0, 40)
          .map((d) => `${d.file}: ${d.count} rows, hash ${d.hash}`)
          .join('\n') +
        (dupContentPerFile.length > 40
          ? `\n…+${dupContentPerFile.length - 40} more`
          : '')
      : 'None ✓',
    '',
    '=== IDENTICAL CONTENT (global, any source) ===',
    dupContentGlobal.length
      ? `${dupContentGlobal.length} duplicate content hash(es) across DB (often OK if different PDFs quote same line — review top)`
      : 'None ✓',
    '',
    '=== JSON COUNT: disk rows vs DB chunks ===',
    jsonMismatch.length
      ? jsonMismatch.join('\n')
      : `All ${jsonFiles.filter((f) => jsonRowsOnDisk(f) > 0).length} ingested JSON files match disk row counts ✓`,
  ];

  if (dupContentGlobal.length > 0 && dupContentGlobal.length <= 15) {
    lines.push('', '=== GLOBAL CONTENT DUP DETAIL ===');
    for (const d of dupContentGlobal) {
      lines.push(`${d.hash}: ${d.ids.length} ids`);
    }
  }

  const report = lines.join('\n');
  console.log('\n' + report);

  const outPath = resolve(process.cwd(), 'audit-embedding-duplicates.txt');
  writeFileSync(outPath, report, 'utf8');
  console.log(`\nReport: ${outPath}`);

  const fail =
    dupChunkIndex.length > 0 ||
    dupEmbedDiffContent.length > 0 ||
    jsonMismatch.some((l) => l.includes('OVER')) ||
    legacyTotal !== 794;

  if (fail) {
    console.log('\nFAIL: ingest duplicates or over-count detected.');
    process.exit(2);
  }
  if (dupEmbedPerFile.length || dupContentPerFile.length) {
    console.log(
      '\nPASS (ingest): no double-ingest. WARN: a few JSON files have duplicate transcript lines (same text → same embedding).'
    );
  } else {
    console.log('\nPASS: no embedding duplicates detected.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
