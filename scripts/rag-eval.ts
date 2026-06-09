/**
 * Generic/open-ended RAG eval — intent + primary + citation alignment.
 *
 * Usage:
 *   npm run rag:eval
 *   npm run rag:eval -- --ci
 *   npm run rag:eval -- --id=generic-pricing-1
 */

import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { ragTestThrottle } from '../src/lib/ai/rag-test-throttle';
import { retrieveStorageRagWithDebug } from '../src/lib/ai/rag-storage';

config({ path: resolve(process.cwd(), '.env') });

type EvalCase = {
  id: string;
  query: string;
  expectIntent?: string | string[];
  expectPrimaryAny?: string[];
  expectPrimaryNone?: string[];
  optional?: boolean;
};

type EvalFile = {
  version: number;
  minPassRate?: number;
  cases: EvalCase[];
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ');
}

function includesAny(haystack: string, needles: string[]): boolean {
  const h = normalize(haystack);
  return needles.some((n) => h.includes(normalize(n)));
}

function parseArgs() {
  const argv = process.argv.slice(2);
  let ci = false;
  let id: string | null = null;
  for (const a of argv) {
    if (a === '--ci') ci = true;
    else if (a.startsWith('--id=')) id = a.slice(5);
  }
  return { ci, id };
}

async function main() {
  const openai = process.env.OPENAI_API_KEY?.trim();
  if (!openai || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    console.error('Need OPENAI_API_KEY and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const { ci, id: onlyId } = parseArgs();
  const filePath = resolve(process.cwd(), 'data/rag-eval-generic.json');
  const spec = JSON.parse(readFileSync(filePath, 'utf8')) as EvalFile;
  let cases = spec.cases;
  if (onlyId) {
    cases = cases.filter((c) => c.id === onlyId);
    if (cases.length === 0) {
      console.error(`No case id=${onlyId}`);
      process.exit(1);
    }
  }

  console.log(`Generic RAG eval — ${cases.length} case(s)\n`);

  const lines: string[] = [];
  let pass = 0;
  let passRequired = 0;
  let required = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;
    const isRequired = !c.optional;
    if (isRequired) required++;
    await ragTestThrottle(i);
    const { result, debug } = await retrieveStorageRagWithDebug(c.query, openai);
    const primary = debug.primaryTitle ?? result?.primarySourceTitle ?? null;
    const citation = debug.citationTitles[0] ?? null;

    const reasons: string[] = [];
    let ok = true;

    if (!primary) {
      ok = false;
      reasons.push('no primary');
    }

    if (c.expectIntent) {
      const expected = Array.isArray(c.expectIntent)
        ? c.expectIntent
        : [c.expectIntent];
      const routed = debug.routedTopicId ?? '';
      const intents = debug.intentRouterIntents ?? [];
      const intentOk = expected.some(
        (e) => routed === e || intents.includes(e)
      );
      if (!intentOk) {
        ok = false;
        reasons.push(
          `intent want [${expected.join('|')}], got route=${routed || 'none'} intents=[${intents.join(',')}]`
        );
      }
    }

    if (primary && c.expectPrimaryAny?.length) {
      if (!includesAny(primary, c.expectPrimaryAny)) {
        ok = false;
        reasons.push(`primary not in [${c.expectPrimaryAny.join(', ')}] — got: ${primary}`);
      }
    }

    if (primary && c.expectPrimaryNone?.length && includesAny(primary, c.expectPrimaryNone)) {
      const bad = c.expectPrimaryNone.find((n) => includesAny(primary!, [n]));
      ok = false;
      reasons.push(`primary must not match "${bad}"`);
    }

    if (primary && citation) {
      const primaryNorm = normalize(primary);
      const citeNorm = normalize(citation);
      if (
        !citeNorm.includes(primaryNorm.slice(0, Math.min(24, primaryNorm.length))) &&
        !primaryNorm.includes(citeNorm.slice(0, Math.min(24, citeNorm.length)))
      ) {
        ok = false;
        reasons.push(`citation misaligned: primary="${primary}" citation="${citation}"`);
      }
    }

    if (ok) {
      pass++;
      if (isRequired) passRequired++;
    }
    const status = ok ? 'PASS' : 'FAIL';
    const suffix = c.optional ? ' (optional)' : '';
    const reason = ok ? `primary OK: ${primary}` : reasons.join('; ');
    const line = `[${status}] ${c.id}${suffix} — ${reason}`;
    console.log(`  ${c.id}… ${status}`);
    lines.push(line);
  }

  const denom = required || cases.length;
  const rate = denom > 0 ? passRequired / denom : 0;
  const minRate = spec.minPassRate ?? 0.9;

  console.log(`\n=== SUMMARY ===`);
  console.log(
    `Pass: ${passRequired} / ${denom} required (${(rate * 100).toFixed(1)}%), ${pass} total incl. optional`
  );
  console.log(`Min pass rate: ${(minRate * 100).toFixed(0)}%`);

  const reportPath = resolve(process.cwd(), 'rag-eval-report.txt');
  writeFileSync(
    reportPath,
    [...lines, '', `Pass: ${pass}/${denom} (${(rate * 100).toFixed(1)}%)`].join('\n')
  );
  console.log(`Report: ${reportPath}`);

  if (ci && rate < minRate) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
