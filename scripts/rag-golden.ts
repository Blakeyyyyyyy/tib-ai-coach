/**
 * Golden RAG regression tests — compare retrieval primary vs expected source.
 *
 * Usage:
 *   npm run rag:golden
 *   npm run rag:golden -- --hard-only
 *   npm run rag:golden -- --easy-only
 *   npm run rag:golden -- --id=hard-fy-hopeful-paraphrase
 */

import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { retrieveStorageRagWithDebug } from '../src/lib/ai/rag-storage';

config({ path: resolve(process.cwd(), '.env') });

type GoldenCase = {
  id: string;
  tier: 'easy' | 'hard';
  query: string;
  expectPrimaryAny?: string[];
  expectPrimaryNone?: string[];
  expectSourcesInPick?: string[];
  minSourcesMatched?: number;
  mode?: 'multi_source';
  optional?: boolean;
  notes?: string;
};

type GoldenFile = {
  version: number;
  cases: GoldenCase[];
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ');
}

function includesAny(haystack: string, needles: string[]): boolean {
  const h = normalize(haystack);
  return needles.some((n) => h.includes(normalize(n)));
}

function evaluateCase(
  c: GoldenCase,
  primary: string | null,
  pickTitles: string[]
): { pass: boolean; reason: string } {
  if (!primary && c.mode !== 'multi_source') {
    return { pass: false, reason: 'no primary (empty retrieval)' };
  }

  if (c.mode === 'multi_source' && c.expectSourcesInPick?.length) {
    const need = c.minSourcesMatched ?? c.expectSourcesInPick.length;
    const blob = pickTitles.join(' | ');
    let matched = 0;
    const hit: string[] = [];
    for (const exp of c.expectSourcesInPick) {
      if (includesAny(blob, [exp])) {
        matched++;
        hit.push(exp);
      }
    }
    if (matched >= need) {
      return { pass: true, reason: `pick includes: ${hit.join(', ')}` };
    }
    return {
      pass: false,
      reason: `need ${need} sources in pick, got ${matched} (${hit.join(', ') || 'none'}) — pick: ${pickTitles.slice(0, 4).join(' | ')}`,
    };
  }

  const title = primary ?? '';

  if (c.expectPrimaryNone?.length && includesAny(title, c.expectPrimaryNone)) {
    const bad = c.expectPrimaryNone.find((n) => includesAny(title, [n]));
    return { pass: false, reason: `primary must not match "${bad}" — got: ${title}` };
  }

  if (c.expectPrimaryAny?.length) {
    if (includesAny(title, c.expectPrimaryAny)) {
      return { pass: true, reason: `primary OK: ${title}` };
    }
    return {
      pass: false,
      reason: `expected one of [${c.expectPrimaryAny.join(', ')}] — got: ${title}`,
    };
  }

  return { pass: false, reason: 'case missing expectPrimaryAny' };
}

async function main() {
  const openai = process.env.OPENAI_API_KEY?.trim();
  if (!openai || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    console.error('Need OPENAI_API_KEY and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const hardOnly = args.includes('--hard-only');
  const easyOnly = args.includes('--easy-only');
  const idArg = args.find((a) => a.startsWith('--id='));
  const filterId = idArg?.slice('--id='.length);

  const goldenPath = resolve(process.cwd(), 'data', 'rag-golden.json');
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as GoldenFile;

  let cases = golden.cases;
  if (filterId) cases = cases.filter((c) => c.id === filterId);
  if (hardOnly) cases = cases.filter((c) => c.tier === 'hard');
  if (easyOnly) cases = cases.filter((c) => c.tier === 'easy');

  if (cases.length === 0) {
    console.error('No cases to run');
    process.exit(1);
  }

  console.log(`Golden RAG tests — ${cases.length} case(s)\n`);

  const lines: string[] = [
    `Golden RAG report — ${new Date().toISOString()}`,
    '',
  ];
  let pass = 0;
  let fail = 0;
  let skipped = 0;
  const byTier = { easy: { pass: 0, fail: 0, total: 0 }, hard: { pass: 0, fail: 0, total: 0 } };

  for (const c of cases) {
    process.stdout.write(`  ${c.id}… `);
    const { result, debug } = await retrieveStorageRagWithDebug(c.query, openai);
    const primary = debug.primaryTitle ?? result?.primarySourceTitle ?? null;
    const { pass: ok, reason } = evaluateCase(c, primary, debug.pickTitles);

    byTier[c.tier].total++;

    if (c.optional && !ok) {
      skipped++;
      console.log('SKIP (optional)');
      lines.push(`[OPTIONAL FAIL] ${c.id} (${c.tier})`);
      lines.push(`  Q: ${c.query}`);
      lines.push(`  ${reason}`);
      lines.push('');
      continue;
    }

    if (ok) {
      pass++;
      byTier[c.tier].pass++;
      console.log('PASS');
      lines.push(`[PASS] ${c.id} (${c.tier}) — ${reason}`);
    } else {
      fail++;
      byTier[c.tier].fail++;
      console.log('FAIL');
      lines.push(`[FAIL] ${c.id} (${c.tier})`);
      lines.push(`  Q: ${c.query}`);
      lines.push(`  ${reason}`);
      if (c.notes) lines.push(`  Note: ${c.notes}`);
      lines.push(
        `  vector=${debug.vectorCount} titleKw=${debug.titleKeywordCount} phrase=${debug.phraseCount} fts=${debug.ftsCount}`
      );
    }
    lines.push('');
  }

  const required = pass + fail;
  const pct = required > 0 ? ((100 * pass) / required).toFixed(1) : '0';

  const summary = [
    '=== SUMMARY ===',
    `Pass: ${pass} / ${required} required (${pct}%)`,
    skipped > 0 ? `Optional not counted: ${skipped}` : '',
    `Easy:   ${byTier.easy.pass}/${byTier.easy.total}`,
    `Hard:   ${byTier.hard.pass}/${byTier.hard.total}`,
    '',
  ]
    .filter(Boolean)
    .join('\n');

  console.log('\n' + summary);
  lines.push(summary);

  const reportPath = resolve(process.cwd(), 'rag-golden-report.txt');
  writeFileSync(reportPath, lines.join('\n'), 'utf8');
  console.log(`Report: ${reportPath}`);

  if (fail > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
