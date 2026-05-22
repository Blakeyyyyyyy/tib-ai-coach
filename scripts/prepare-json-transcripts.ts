/**
 * Normalize raw transcript JSON (single blob) → chunked array with overlap.
 * Skips files that are already chunked arrays unless --force.
 *
 * Usage:
 *   npx tsx scripts/prepare-json-transcripts.ts
 *   npx tsx scripts/prepare-json-transcripts.ts data/json/Momentum_Meet_7_May_2025.json
 */
import fs from 'fs';
import path from 'path';
import {
  buildOverlappingChunks,
  chunksToExportItems,
  extractVideoUrl,
  formatDisplayName,
  isLineExportArray,
  mergeLineExportToChunks,
  normalizeCaptionExportItems,
} from '../src/lib/transcript-chunking';

const JSON_DIR = path.join(process.cwd(), 'data', 'json');

type RawBlob = {
  video_name?: string;
  text?: string;
  video_url?: string;
  url?: string;
};
type ChunkItem = {
  video_name?: string;
  video_url?: string;
  start_time?: string;
  text?: string;
};

function isRawBlob(data: unknown): data is RawBlob {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  const o = data as RawBlob;
  if (typeof o.text === 'string' && o.text.length > 500) return true;
  return typeof o.video_name === 'string' && typeof o.url === 'string';
}

function resolveTxtPath(urlOrPath: string, jsonBase: string): string | null {
  const fileName = urlOrPath.replace(/^.*[/\\]/, '').trim();
  const candidates = [
    path.join(JSON_DIR, fileName),
    path.join(JSON_DIR, `${jsonBase}.txt`),
    path.join(process.cwd(), 'data', 'transcripts', fileName),
    path.join(process.cwd(), 'data', 'transcripts', `${jsonBase}.txt`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function loadTranscriptFromStub(data: RawBlob, jsonBase: string): {
  text: string | null;
  videoUrl: string | null;
} {
  let videoUrl: string | null =
    data.video_url?.trim() ||
    (data.url?.trim().startsWith('http') ? data.url.trim() : null) ||
    null;

  if (typeof data.text === 'string' && data.text.trim()) {
    const extracted = extractVideoUrl(data.text);
    if (!videoUrl) videoUrl = extracted.url;
    return { text: extracted.body, videoUrl };
  }

  if (data.url && !data.url.startsWith('http')) {
    const txtPath = resolveTxtPath(data.url, jsonBase);
    if (txtPath) {
      const raw = fs.readFileSync(txtPath, 'utf8');
      const extracted = extractVideoUrl(raw);
      if (!videoUrl) videoUrl = extracted.url;
      return { text: extracted.body, videoUrl };
    }
  }

  return { text: null, videoUrl };
}

function isChunkedArray(data: unknown): data is ChunkItem[] {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    typeof data[0]?.start_time === 'string' &&
    typeof data[0]?.text === 'string'
  );
}

function processFile(filePath: string, force: boolean): boolean {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data: unknown = JSON.parse(raw);
  const base = path.basename(filePath, '.json');

  if (isChunkedArray(data)) {
    const lineItems = data.filter(
      (c) => c?.video_name?.trim() && c?.video_url?.trim() && c?.text?.trim()
    ) as {
      video_name: string;
      video_url: string;
      start_time?: string;
      end_time?: string;
      text: string;
    }[];

    if (lineItems.length && isLineExportArray(lineItems)) {
      const normalized = normalizeCaptionExportItems(lineItems);
      const out = mergeLineExportToChunks(normalized);
      fs.writeFileSync(filePath, JSON.stringify(out, null, 2), 'utf8');
      console.log(
        `  OK ${path.basename(filePath)} — merged ${lineItems.length} lines → ${out.length} chunks`
      );
      return true;
    }

    if (!force && data[0]?.video_url) {
      const avg =
        data.reduce((s, c) => s + (c.text?.length ?? 0), 0) / data.length;
      if (avg >= 120) {
        console.log(`  skip (already chunked): ${path.basename(filePath)}`);
        return false;
      }
    }
  }

  let transcriptText: string;
  let videoName: string;
  let videoUrl: string | null = null;

  if (isRawBlob(data)) {
    videoName = data.video_name ?? base;
    const loaded = loadTranscriptFromStub(data, base);
    transcriptText = loaded.text ?? '';
    videoUrl = loaded.videoUrl;
    if (!transcriptText.trim()) {
      console.error(
        `  ERROR: ${path.basename(filePath)} — add a "text" field, a .txt file in data/json or data/transcripts, or paste the transcript into the JSON.`
      );
      return false;
    }
  } else {
    console.log(`  skip (unrecognized format): ${path.basename(filePath)}`);
    return false;
  }

  if (!videoUrl) {
    console.error(
      `  ERROR: ${path.basename(filePath)} — no Vimeo URL (use video_url or url: https://vimeo.com/...)`
    );
    return false;
  }

  const displayName = formatDisplayName(videoName.replace(/\.json$/i, ''));
  const chunks = buildOverlappingChunks(transcriptText);
  if (!chunks.length) {
    console.error(`  ERROR: no segments parsed in ${path.basename(filePath)}`);
    return false;
  }

  const out = chunksToExportItems(chunks, displayName, videoUrl);
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2), 'utf8');
  console.log(
    `  OK ${path.basename(filePath)} → ${out.length} chunks (overlap ~${100} chars)`
  );
  return true;
}

function main() {
  const force = process.argv.includes('--force');
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const files =
    args.length > 0
      ? args.map((a) => path.resolve(a))
      : fs
          .readdirSync(JSON_DIR)
          .filter((f) => f.endsWith('.json'))
          .map((f) => path.join(JSON_DIR, f));

  console.log(`Preparing ${files.length} JSON file(s)…\n`);
  let done = 0;
  for (const fp of files) {
    if (processFile(fp, force)) done++;
  }
  console.log(`\nDone: ${done} file(s) normalized. Run: npm run ingest:json:batch`);
}

main();
