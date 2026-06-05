/**
 * Debug RAG for any question: retrieval counts, primary source, pick, citations.
 *
 * Usage: npm run rag:debug -- "Your question here"
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { retrieveStorageRagWithDebug } from '../src/lib/ai/rag-storage';
import { fetchTitleKeywordMatches } from '../src/lib/ai/rag-title-keyword-search';
import { createServiceRoleClient } from '../src/lib/supabase/service-role';

config({ path: resolve(process.cwd(), '.env') });

async function main() {
  const query =
    process.argv.slice(2).join(' ').trim() ||
    "A tradie's website gets traffic but no calls. Based on Rhys's marketing experience, what are the most likely reasons and what should they audit first?";

  const openai = process.env.OPENAI_API_KEY?.trim();
  if (!openai || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    console.error('Need OPENAI_API_KEY and SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  console.log('Query:', query, '\n');

  const admin = createServiceRoleClient();
  const titleHits = await fetchTitleKeywordMatches(admin, query);
  const uniqueTitles = [...new Set(titleHits.map((r) => r.source_title))];

  const { result, debug } = await retrieveStorageRagWithDebug(query, openai);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { count: rhysCount } = await sb
      .from('knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .ilike('source_title', '%Rhys%');
    console.log('DB: chunks with Rhys in source_title:', rhysCount ?? 0);
  }

  console.log('Retrieval');
  if (debug.routedTopicId) {
    console.log(
      '  session route:      ',
      `${debug.routedTopicId} (${debug.routedLabel}, conf=${debug.routedConfidence?.toFixed(2)})`
    );
    if (debug.routedDocKeys.length > 0) {
      console.log('  routed sessions:    ', debug.routedDocKeys.join(' | '));
    }
  }
  console.log(
    '  rewrite gate:       ',
    debug.rewriteMode != null
      ? `${debug.rewriteMode} (score=${debug.rewriteScore?.toFixed(2) ?? '?'})`
      : '(n/a)'
  );
  if (debug.rewriteSignals.length > 0) {
    console.log('  rewrite signals:    ', debug.rewriteSignals.join(', '));
  }
  if (debug.topicHintUsed) {
    console.log('  topic hint:          yes (from conversation memory)');
  }
  console.log('  LLM rewrite:        ', debug.llmRewriteUsed ? 'yes' : 'no');
  if (debug.llmRewriteUsed) {
    console.log('  rewrite queries:    ', debug.llmSearchQueries.join(' | '));
    console.log('  vector query count: ', debug.vectorQueryCount);
    if (debug.sessionAgreementDocs.length > 0) {
      console.log('  session agreement:  ', debug.sessionAgreementDocs.join(' | '));
    }
  }
  console.log('  vector hits:        ', debug.vectorCount);
  console.log('  title-keyword hits: ', debug.titleKeywordCount);
  console.log('  phrase hits:        ', debug.phraseCount);
  console.log('  FTS hits:           ', debug.ftsCount);
  console.log('\nTitle-keyword unique sources (' + uniqueTitles.length + '):');
  for (const t of uniqueTitles.slice(0, 8)) console.log('  -', t);
  console.log('\nTop vector titles:');
  for (const t of debug.topVectorTitles) console.log('  -', t);
  console.log('\nPrimary (after rerank + title anchor):', debug.primaryTitle ?? '(none)');
  console.log('\nContext chunks (pick):');
  for (const t of debug.pickTitles) console.log('  -', t);
  console.log('\nCitations shown to user:');
  for (const t of debug.citationTitles) console.log('  -', t);

  if (!result) {
    console.log('\nNo RAG context returned (empty retrieval).');
    process.exit(1);
  }

  console.log('\nContext preview (first 800 chars):');
  console.log(result.contextBlock.slice(0, 800) + (result.contextBlock.length > 800 ? '…' : ''));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
