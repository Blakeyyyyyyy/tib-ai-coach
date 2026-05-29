/**
 * Smoke test for Cohere rerank. Run: npx tsx scripts/test-cohere-rerank.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { rerankPassagesWithCohere } from '../src/lib/ai/rerank-cohere';

config({ path: resolve(process.cwd(), '.env') });

async function main() {
  const key = process.env.COHERE_API_KEY?.trim();
  if (!key) {
    console.error('FAIL: COHERE_API_KEY is not set in .env');
    process.exit(1);
  }

  const query = 'How do I improve cash flow in my trade business?';
  const passages = [
    {
      index: 0,
      title: 'Social Media Scheduling',
      text: 'Post consistently on Instagram and use scheduling tools.',
      similarity: 0.42,
    },
    {
      index: 1,
      title: 'Managing Debtors',
      text: 'Chase overdue invoices weekly and set clear payment terms on every job.',
      similarity: 0.38,
    },
    {
      index: 2,
      title: 'Cash Flow Playbook',
      text: 'Forecast weekly inflows, separate tax money, and negotiate supplier terms.',
      similarity: 0.35,
    },
  ];

  console.log('Query:', query);
  console.log('Calling Cohere rerank...\n');

  const start = Date.now();
  const { order, drop } = await rerankPassagesWithCohere(query, passages, key);
  const ms = Date.now() - start;

  console.log('Rerank order (most relevant first):', order);
  console.log('Dropped indices:', drop.length ? drop : '(none)');
  console.log('Latency:', ms, 'ms');

  const top = order[0];
  if (top === 2) {
    console.log('\nPASS: Cash flow playbook ranked first.');
    process.exit(0);
  }

  console.log(
    `\nWARN: Expected index 2 first, got ${top}. API responded — check ranking quality.`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
