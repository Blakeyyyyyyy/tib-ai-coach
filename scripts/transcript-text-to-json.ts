/**
 * Parse plain transcript (Speaker [HH:MM:SS]: text) into RAG-friendly JSON chunks.
 * Matches TiB Vimeo exports: one caption block per row, end_time = next start.
 *
 * Usage: tsx scripts/transcript-text-to-json.ts <input.txt> <output.json> "Video Name" "https://..."
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

type Segment = { startSec: number; text: string };

const SEGMENT_RE =
  /^(.+?)\s+\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]:\s*(.*)$/;

const TARGET_CHARS = 320;
const MAX_CHARS = 480;
const MIN_CHARS_TO_SPLIT = 380;

function parseTime(h: number, m: number, s: number): number {
  return h * 3600 + m * 60 + s;
}

function toMmSs(totalSec: number): string {
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function parseSegments(raw: string): Segment[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const segments: Segment[] = [];
  let current: Segment | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = SEGMENT_RE.exec(trimmed);
    if (m) {
      if (current && current.text.trim()) segments.push(current);
      const h = parseInt(m[2], 10);
      const min = parseInt(m[3], 10);
      const sec = m[4] ? parseInt(m[4], 10) : 0;
      const rest = m[5]?.trim() ?? '';
      current = { startSec: parseTime(h, min, sec), text: rest };
    } else if (current) {
      current.text += (current.text ? ' ' : '') + trimmed;
    }
  }
  if (current && current.text.trim()) segments.push(current);

  return segments.map((s) => ({
    ...s,
    text: s.text.replace(/\s+/g, ' ').trim(),
  }));
}

/** Split long text at sentence boundaries for embedding quality. */
function splitLongText(
  text: string,
  startSec: number,
  endSec: number
): { text: string; startSec: number; endSec: number }[] {
  if (text.length <= MAX_CHARS) {
    return [{ text, startSec, endSec }];
  }

  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  const parts: string[] = [];
  let buf = '';

  for (const s of sentences) {
    const piece = s.trim();
    if (!piece) continue;
    if (buf.length + piece.length + 1 <= TARGET_CHARS) {
      buf = buf ? `${buf} ${piece}` : piece;
    } else {
      if (buf) parts.push(buf);
      buf = piece;
    }
  }
  if (buf) parts.push(buf);

  if (parts.length <= 1) {
    return [{ text, startSec, endSec }];
  }

  const span = Math.max(endSec - startSec, parts.length * 3);
  const slice = Math.floor(span / parts.length);
  return parts.map((p, i) => ({
    text: p,
    startSec: startSec + i * slice,
    endSec: i === parts.length - 1 ? endSec : startSec + (i + 1) * slice,
  }));
}

/**
 * One caption per chunk; merge only ultra-short same-second fragments;
 * split very long blocks at sentences.
 */
function buildChunks(segments: Segment[]): { startSec: number; endSec: number; text: string }[] {
  if (segments.length === 0) return [];

  const merged: Segment[] = [];
  for (let i = 0; i < segments.length; i++) {
    let seg = { ...segments[i]! };
    while (
      i + 1 < segments.length &&
      segments[i + 1]!.startSec === seg.startSec &&
      seg.text.length + segments[i + 1]!.text.length < 120
    ) {
      seg.text = `${seg.text} ${segments[i + 1]!.text}`.trim();
      i++;
    }
    merged.push(seg);
  }

  const raw: { startSec: number; endSec: number; text: string }[] = [];

  for (let i = 0; i < merged.length; i++) {
    const seg = merged[i]!;
    const next = merged[i + 1];
    let endSec = next ? next.startSec : seg.startSec + Math.min(15, Math.ceil(seg.text.length / 14));

    if (endSec <= seg.startSec) endSec = seg.startSec + 3;

    if (seg.text.length >= MIN_CHARS_TO_SPLIT) {
      raw.push(...splitLongText(seg.text, seg.startSec, endSec));
    } else {
      raw.push({ startSec: seg.startSec, endSec, text: seg.text });
    }
  }

  const out: typeof raw = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    const next = raw[i + 1];
    let endSec = next ? next.startSec : c.endSec;
    if (endSec <= c.startSec) endSec = c.startSec + 3;

    // Merge tiny tail into previous if both very short
    if (
      out.length > 0 &&
      c.text.length < 50 &&
      endSec - c.startSec <= 3 &&
      out[out.length - 1]!.text.length < 200
    ) {
      const prev = out[out.length - 1]!;
      prev.text = `${prev.text} ${c.text}`.trim();
      prev.endSec = endSec;
      continue;
    }

    out.push({ startSec: c.startSec, endSec, text: c.text });
  }

  return out.filter((c) => c.text.length >= 8);
}

async function main() {
  const args = process.argv.slice(2);
  const rmInput = args.includes('--rm-input');
  const filtered = args.filter((a) => a !== '--rm-input');
  const [inPath, outPath, videoName, videoUrl] = filtered;
  if (!inPath || !outPath || !videoName || !videoUrl) {
    console.error(
      'Usage: tsx scripts/transcript-text-to-json.ts <in.txt|- > <out.json> "Video Name" "url" [--rm-input]'
    );
    process.exit(1);
  }

  const raw =
    inPath === '-'
      ? await new Promise<string>((res, rej) => {
          const chunks: Buffer[] = [];
          process.stdin.on('data', (c) => chunks.push(c));
          process.stdin.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
          process.stdin.on('error', rej);
        })
      : await readFile(resolve(process.cwd(), inPath), 'utf8');
  const body = raw.split(/\n\s*Video Name:/i)[0]!.trim();
  const segments = parseSegments(body);
  if (segments.length === 0) {
    console.error('No segments parsed');
    process.exit(1);
  }

  const chunks = buildChunks(segments);
  const items = chunks.map((c) => ({
    video_name: videoName,
    video_url: videoUrl,
    start_time: toMmSs(c.startSec),
    end_time: toMmSs(c.endSec),
    text: c.text,
  }));

  const outFull = resolve(process.cwd(), outPath);
  await writeFile(outFull, JSON.stringify(items, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${items.length} chunks → ${outPath}`);
  console.log(
    `Duration ~${toMmSs(chunks[0]!.startSec)} – ${toMmSs(chunks[chunks.length - 1]!.endSec)}`
  );

  if (rmInput && inPath !== '-') {
    const { unlink } = await import('fs/promises');
    await unlink(resolve(process.cwd(), inPath)).catch(() => undefined);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
