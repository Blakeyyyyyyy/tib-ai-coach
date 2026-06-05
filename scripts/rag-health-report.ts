/**
 * RAG health: chunk distribution, config scores, sample retrieval quality.
 * Usage: npm run rag:health
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { embedQuery } from '../src/lib/ai/openai-embed';
import { retrieveStorageRagWithDebug } from '../src/lib/ai/rag-storage';

config({ path: resolve(process.cwd(), '.env') });

const BUCKET = process.env.RAG_STORAGE_BUCKET ?? 'Rag';
const PAGE = 1000;

const SAMPLE_QUERIES = [
  "Joe's session transformational improv how tradies learn",
  "Rhys website traffic no calls marketing audit",
  'Systemology documenting systems overwhelm where to start',
  'cash flow tradie stress invoices',
  'Get Off the Tools delegation',
];

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

  const pdfByPath = new Map<string, number>();
  const jsonByFile = new Map<string, number>();
  const videoByTitle = new Map<string, number>();
  let total = 0;
  let offset = 0;

  for (;;) {
    const { data, error } = await admin
      .from('knowledge_chunks')
      .select('metadata, source_title')
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      total++;
      const meta = row.metadata as Record<string, unknown> | null;
      const st = meta?.source_type;
      const sf = typeof meta?.source_file === 'string' ? meta.source_file : '';
      const sp = typeof meta?.storage_path === 'string' ? meta.storage_path : '';
      if (st === 'video_transcript' && sf) {
        jsonByFile.set(sf, (jsonByFile.get(sf) ?? 0) + 1);
        const vn = typeof meta?.video_name === 'string' ? meta.video_name : row.source_title;
        if (vn) videoByTitle.set(vn, (videoByTitle.get(vn) ?? 0) + 1);
      } else if (sp) {
        pdfByPath.set(sp, (pdfByPath.get(sp) ?? 0) + 1);
      }
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  const topPdf = [...pdfByPath.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  const topJson = [...jsonByFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  const topVideo = [...videoByTitle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  const videoChunks = [...jsonByFile.values()].reduce((a, b) => a + b, 0);
  const pdfChunks = [...pdfByPath.values()].reduce((a, b) => a + b, 0);

  console.log('=== LIBRARY ===');
  console.log(`Total chunks: ${total}`);
  console.log(`PDF files: ${pdfByPath.size} (${pdfChunks} chunks, avg ${(pdfChunks / pdfByPath.size || 0).toFixed(1)})`);
  console.log(`JSON sessions: ${jsonByFile.size} (${videoChunks} chunks, avg ${(videoChunks / jsonByFile.size || 0).toFixed(1)})`);

  console.log('\n=== RAG SCORES / ENV ===');
  const envKeys = [
    'RAG_MATCH_THRESHOLD',
    'RAG_VECTOR_MATCH_COUNT',
    'RAG_CONTEXT_CHUNKS',
    'RAG_FTS_MATCH_COUNT',
    'RAG_KNOWLEDGE_BASE_MAX_LINKS',
    'RAG_MAX_SOURCE_DOCS',
    'RAG_COHERE_RERANK_TOP_N',
    'RAG_COHERE_RERANK_MIN_SCORE',
    'RAG_JSON_EMBED_BATCH',
    'RAG_CHUNK_SIZE',
    'RAG_CHUNK_OVERLAP',
  ];
  for (const k of envKeys) {
    console.log(`  ${k}=${process.env[k] ?? '(code default)'}`);
  }
  console.log('  Merge boosts: title=0.993, phrase=0.991, FTS base=0.9');

  console.log('\n=== TOP PDFs BY CHUNK COUNT ===');
  for (const [p, n] of topPdf) console.log(`  ${n}\t${p}`);

  console.log('\n=== TOP JSON FILES BY CHUNK COUNT ===');
  for (const [f, n] of topJson) console.log(`  ${n}\t${f}`);

  console.log('\n=== TOP VIDEO TITLES (sessions) ===');
  for (const [t, n] of topVideo) console.log(`  ${n}\t${t}`);

  console.log('\n=== SAMPLE RETRIEVAL (primary + citations) ===');
  for (const q of SAMPLE_QUERIES) {
    const { result, debug } = await retrieveStorageRagWithDebug(q, openai);
    console.log(`\nQ: ${q.slice(0, 70)}…`);
    console.log(`  vector=${debug.vectorCount} titleKw=${debug.titleKeywordCount} phrase=${debug.phraseCount} fts=${debug.ftsCount}`);
    console.log(`  primary: ${debug.primaryTitle ?? '—'}`);
    console.log(`  citations: ${debug.citationTitles.join(' | ') || '—'}`);
    if (!result) console.log('  (no context)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
