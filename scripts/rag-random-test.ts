/**
 * Generate random coach questions from transcript JSON + rag-golden.json.
 * Use for local RAG / coach testing.
 *
 * Usage:
 *   npm run rag:random                    # 8 questions (print only)
 *   npm run rag:random -- --count=12
 *   npm run rag:random -- --run           # also run RAG retrieval per question
 *   npm run rag:random -- --golden=0.4    # 40% from golden, 60% from JSON
 *   npm run rag:random -- --save          # write data/rag-random-questions.json
 *   npm run rag:random -- --seed=42       # reproducible shuffle
 */

import { config } from 'dotenv';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { sessionTitleMatchScore } from '../src/lib/ai/rag-explicit-session';
import { retrieveStorageRagWithDebug } from '../src/lib/ai/rag-storage';
import {
  resolveTranscriptSessionTitle,
  sessionTitleFromJsonFilename,
} from '../src/lib/transcript-display-title';

config({ path: resolve(process.cwd(), '.env') });

type TranscriptChunk = {
  video_name?: string;
  text?: string;
  start_time?: string;
};

type GoldenCase = { id: string; query: string; tier?: string };

type GeneratedQuestion = {
  id: string;
  source: 'json' | 'golden';
  session: string;
  file?: string;
  query: string;
};

const STOP = new Set(
  'the a an and or but in on at to for of is are was were be been being have has had do does did will would could should may might that this these those with from your you they them their our we i it as if so not about what when where how who'.split(
    ' '
  )
);

function parseArgs() {
  const argv = process.argv.slice(2);
  let count = 8;
  let goldenRatio = 0.25;
  let run = false;
  let save = false;
  let seed: number | null = null;
  for (const a of argv) {
    if (a === '--run') run = true;
    else if (a === '--save') save = true;
    else if (a.startsWith('--count=')) count = Math.max(1, parseInt(a.slice(8), 10) || 8);
    else if (a.startsWith('--golden=')) {
      goldenRatio = Math.min(1, Math.max(0, parseFloat(a.slice(9)) || 0.25));
    } else if (a.startsWith('--seed=')) seed = parseInt(a.slice(7), 10);
  }
  return { count, goldenRatio, run, save, seed };
}

function mulberry32(s: number) {
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)]!;
}

function keywords(text: string, max = 5): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 4 && !STOP.has(w));
  const uniq: string[] = [];
  for (const w of words) {
    if (!uniq.includes(w)) uniq.push(w);
    if (uniq.length >= max) break;
  }
  return uniq.length ? uniq : ['business', 'tradies'];
}

function snippet(text: string, maxWords = 14): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const sentence = clean.split(/[.!?]/).find((s) => s.trim().length > 40)?.trim() ?? clean;
  const words = sentence.split(/\s+/).slice(0, maxWords);
  return words.join(' ');
}

const QUESTION_TEMPLATES = [
  (session: string, topic: string) =>
    `What does the TiB session "${session}" say about ${topic}?`,
  (session: string, topic: string) =>
    `According to ${session}, what should a tradie know about ${topic}?`,
  (session: string, _topic: string, snip: string) =>
    `In ${session}, they mentioned: "${snip}" — what is the main takeaway for my business?`,
  (session: string, topic: string) =>
    `I'm a tradie — how does ${session} recommend handling ${topic}?`,
  (session: string, topic: string) =>
    `Summarise the practical advice from ${session} on ${topic}.`,
  (_session: string, topic: string) =>
    `My question is about ${topic} — what does TiB material in the knowledge base say?`,
];

function loadJsonFiles(): string[] {
  const dir = resolve(process.cwd(), 'data', 'json');
  return readdirSync(dir).filter((f) => f.endsWith('.json'));
}

function loadGolden(): GoldenCase[] {
  const path = resolve(process.cwd(), 'data', 'rag-golden.json');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { cases: GoldenCase[] };
  return raw.cases ?? [];
}

function questionFromJson(file: string, rnd: () => number): GeneratedQuestion | null {
  const path = resolve(process.cwd(), 'data', 'json', file);
  let items: TranscriptChunk[];
  try {
    items = JSON.parse(readFileSync(path, 'utf8')) as TranscriptChunk[];
  } catch {
    return null;
  }
  const valid = items.filter((c) => (c.text?.trim().length ?? 0) > 60);
  if (!valid.length) return null;

  const chunk = pick(valid, rnd);
  const videoName = chunk.video_name?.trim() || file.replace(/\.json$/i, '');
  const session = resolveTranscriptSessionTitle(
    file,
    videoName,
    sessionTitleFromJsonFilename(file, videoName)
  );
  const text = chunk.text!.trim();
  const topic = keywords(text).join(' ');
  const snip = snippet(text);
  const datedSession =
    /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(
      session
    ) || /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}/i.test(session);
  const pool = datedSession
    ? QUESTION_TEMPLATES.filter((_, i) => i === 0 || i === 1 || i === 3)
    : QUESTION_TEMPLATES;
  const tpl = pick(pool, rnd);
  const query = tpl(session, topic, snip);

  const id = `json-${file.replace(/\.json$/i, '').slice(0, 24)}-${Math.floor(rnd() * 1e6)}`;
  return { id, source: 'json', session, file, query };
}

function questionFromGolden(cases: GoldenCase[], rnd: () => number): GeneratedQuestion {
  const c = pick(cases, rnd);
  return {
    id: `golden-${c.id}`,
    source: 'golden',
    session: c.id,
    query: c.query,
  };
}

function generateBatch(opts: {
  count: number;
  goldenRatio: number;
  seed: number | null;
}): GeneratedQuestion[] {
  const rnd = opts.seed != null ? mulberry32(opts.seed) : Math.random;
  const files = loadJsonFiles();
  const golden = loadGolden();
  const out: GeneratedQuestion[] = [];
  const seen = new Set<string>();

  while (out.length < opts.count) {
    const fromGolden = golden.length > 0 && rnd() < opts.goldenRatio;
    const q = fromGolden
      ? questionFromGolden(golden, rnd)
      : questionFromJson(pick(files, rnd), rnd);
    if (!q || seen.has(q.query)) continue;
    seen.add(q.query);
    out.push(q);
  }
  return out;
}

async function runRagChecks(questions: GeneratedQuestion[], openai: string) {
  console.log('\n--- RAG retrieval (--run) ---\n');
  let ok = 0;
  let sessionMatch = 0;
  let sessionNamed = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    console.log(`[${i + 1}/${questions.length}] ${q.query.slice(0, 90)}${q.query.length > 90 ? '…' : ''}`);
    const { result, debug } = await retrieveStorageRagWithDebug(q.query, openai);
    const primary = debug.primaryTitle ?? '(none)';
    const pass = !!result?.contextBlock;
    if (pass) ok++;
    let anchorNote = '';
    if (q.source === 'json' && q.session) {
      sessionNamed++;
      const score = sessionTitleMatchScore(q.session, primary);
      if (score >= 70) sessionMatch++;
      anchorNote = ` | session-match=${score}${score >= 70 ? ' OK' : ' MISS'}`;
    }
    console.log(
      `  → primary: ${primary.slice(0, 70)}${primary.length > 70 ? '…' : ''} | vector=${debug.vectorCount} fts=${debug.ftsCount} route=${debug.routedTopicId ?? '-'}${anchorNote}`
    );
    if (debug.citationTitles.length) {
      console.log(`  → citations: ${debug.citationTitles.slice(0, 2).join(' | ')}`);
    }
    console.log('');
  }
  console.log(`RAG returned context for ${ok}/${questions.length} questions.`);
  if (sessionNamed > 0) {
    console.log(
      `Named-session primaries: ${sessionMatch}/${sessionNamed} matched expected session (score ≥70).`
    );
  }
  console.log('');
}

async function main() {
  const { count, goldenRatio, run, save, seed } = parseArgs();
  const openai = process.env.OPENAI_API_KEY?.trim();

  const questions = generateBatch({ count, goldenRatio, seed });
  const generatedAt = new Date().toISOString();

  console.log(`\n${questions.length} random test questions (${Math.round(goldenRatio * 100)}% golden, rest from data/json)\n`);
  console.log('Copy any line into http://localhost:3000/coach to test the full coach + RAG UI.\n');
  console.log('─'.repeat(72));

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    console.log(`\n${i + 1}. [${q.source}] ${q.session}`);
    console.log(`   ${q.query}`);
    if (q.file) console.log(`   (from ${q.file})`);
  }

  console.log('\n' + '─'.repeat(72));
  console.log('\nQuick commands:');
  console.log('  npm run rag:random -- --run --count=5     # run RAG only (no coach UI)');
  console.log('  npm run rag:debug -- "paste question"     # one question, full debug');
  console.log('  npm run rag:golden                        # fixed regression tests\n');

  if (save) {
    const outPath = resolve(process.cwd(), 'data', 'rag-random-questions.json');
    writeFileSync(
      outPath,
      JSON.stringify({ generatedAt, seed, count, goldenRatio, questions }, null, 2),
      'utf8'
    );
    console.log(`Saved: ${outPath}\n`);
  }

  if (run) {
    if (!openai || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      console.error('Need OPENAI_API_KEY and SUPABASE_SERVICE_ROLE_KEY for --run');
      process.exit(1);
    }
    await runRagChecks(questions, openai);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
