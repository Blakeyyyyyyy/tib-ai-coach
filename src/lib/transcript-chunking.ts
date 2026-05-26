/**
 * RAG-oriented transcript chunking: speaker timestamps, sentence boundaries,
 * and sliding overlap so adjacent chunks share context for retrieval.
 */

export type TimedUtterance = { startSec: number; endSec: number; text: string };

export type TranscriptChunk = {
  startSec: number;
  endSec: number;
  text: string;
};

const SEGMENT_RE =
  /^(.+?)\s+\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]:\s*(.*)$/;

/** ~380 chars balances embedding quality vs specificity for coaching transcripts */
export const TARGET_CHARS = 380;
export const OVERLAP_CHARS = 100;
export const MIN_CHUNK_CHARS = 60;
export const MAX_CHUNK_CHARS = 520;

export function parseTime(h: number, m: number, s: number): number {
  return h * 3600 + m * 60 + s;
}

export function toMmSs(totalSec: number): string {
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** Parses MM:SS, HH:MM:SS, or HH:MM:SS.mmm (caption exports). */
export function parseTimestampToSeconds(t: string): number {
  const parts = t.trim().split(':');
  if (parts.length === 3) {
    const h = parseInt(parts[0]!, 10) || 0;
    const m = parseInt(parts[1]!, 10) || 0;
    const s = parseFloat(parts[2]!) || 0;
    return Math.floor(h * 3600 + m * 60 + s);
  }
  if (parts.length === 2) {
    const m = parseInt(parts[0]!, 10) || 0;
    const s = parseFloat(parts[1]!) || 0;
    return Math.floor(m * 60 + s);
  }
  return 0;
}

export function parseMmSsToSeconds(t: string): number {
  return parseTimestampToSeconds(t);
}

export function parseSegments(raw: string): { startSec: number; text: string }[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const segments: { startSec: number; text: string }[] = [];
  let current: { startSec: number; text: string } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = SEGMENT_RE.exec(trimmed);
    if (m) {
      if (current?.text.trim()) segments.push(current);
      const h = parseInt(m[2], 10);
      const min = parseInt(m[3], 10);
      const sec = m[4] ? parseInt(m[4], 10) : 0;
      current = { startSec: parseTime(h, min, sec), text: m[5]?.trim() ?? '' };
    } else if (current) {
      current.text += (current.text ? ' ' : '') + trimmed;
    }
  }
  if (current?.text.trim()) segments.push(current);

  return segments.map((s) => ({
    ...s,
    text: s.text.replace(/\s+/g, ' ').trim(),
  }));
}

export function extractVideoUrl(text: string): { body: string; url: string | null } {
  const patterns = [
    /Video\s+URL:\s*(https:\/\/[^\s\n]+)/i,
    /video_url["']?\s*:\s*["']?(https:\/\/[^\s"'\n]+)/i,
  ];
  let url: string | null = null;
  let body = text;
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      url = m[1].trim();
      body = text.replace(m[0], '').trim();
      break;
    }
  }
  body = body.replace(/Video\s+name:[^\n]*/gi, '').trim();
  return { body, url };
}

export function formatDisplayName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeTinySegments(
  segments: { startSec: number; text: string }[]
): { startSec: number; text: string }[] {
  const merged: typeof segments = [];
  for (let i = 0; i < segments.length; i++) {
    let seg = { ...segments[i]! };
    while (
      i + 1 < segments.length &&
      segments[i + 1]!.startSec === seg.startSec &&
      seg.text.length + segments[i + 1]!.text.length < 140
    ) {
      seg.text = `${seg.text} ${segments[i + 1]!.text}`.trim();
      i++;
    }
    merged.push(seg);
  }
  return merged;
}

function segmentsToUtterances(
  segments: { startSec: number; text: string }[]
): TimedUtterance[] {
  const merged = mergeTinySegments(segments);
  const out: TimedUtterance[] = [];
  for (let i = 0; i < merged.length; i++) {
    const seg = merged[i]!;
    const next = merged[i + 1];
    let endSec = next
      ? next.startSec
      : seg.startSec + Math.min(20, Math.max(5, Math.ceil(seg.text.length / 16)));
    if (endSec <= seg.startSec) endSec = seg.startSec + 3;
    if (seg.text.length >= MIN_CHUNK_CHARS) {
      out.push({ startSec: seg.startSec, endSec, text: seg.text });
    }
  }
  return out;
}

function splitLongUtterance(utt: TimedUtterance): TimedUtterance[] {
  if (utt.text.length <= MAX_CHUNK_CHARS) return [utt];
  const sentences = utt.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [utt.text];
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
  if (parts.length <= 1) return [utt];

  const span = Math.max(utt.endSec - utt.startSec, parts.length * 4);
  const slice = Math.max(3, Math.floor(span / parts.length));
  return parts.map((p, i) => ({
    startSec: utt.startSec + i * slice,
    endSec: i === parts.length - 1 ? utt.endSec : utt.startSec + (i + 1) * slice,
    text: p,
  }));
}

function utterancesToChunks(utterances: TimedUtterance[]): TranscriptChunk[] {
  const flat: TimedUtterance[] = [];
  for (const u of utterances) {
    flat.push(...splitLongUtterance(u));
  }

  const chunks: TranscriptChunk[] = [];
  let buf: TimedUtterance[] = [];

  const flush = (overlapFromEnd: boolean) => {
    if (!buf.length) return;
    const text = buf.map((u) => u.text).join(' ').trim();
    if (text.length < MIN_CHUNK_CHARS) {
      buf = overlapFromEnd ? peelOverlap(buf) : [];
      return;
    }
    const startSec = buf[0]!.startSec;
    const endSec = buf[buf.length - 1]!.endSec;
    chunks.push({ startSec, endSec, text });
    buf = overlapFromEnd ? peelOverlap(buf) : [];
  };

  const peelOverlap = (items: TimedUtterance[]): TimedUtterance[] => {
    if (!items.length) return [];
    let acc = 0;
    const peeled: TimedUtterance[] = [];
    for (let i = items.length - 1; i >= 0; i--) {
      peeled.unshift(items[i]!);
      acc += items[i]!.text.length + 1;
      if (acc >= OVERLAP_CHARS) break;
    }
    return peeled.length ? peeled : [items[items.length - 1]!];
  };

  for (const u of flat) {
    buf.push(u);
    const len = buf.map((b) => b.text).join(' ').length;
    if (len >= TARGET_CHARS) {
      flush(true);
    }
  }
  flush(false);

  return chunks;
}

/** Build overlapping chunks from raw transcript text (Speaker [HH:MM:SS]: lines). */
export function buildOverlappingChunks(rawTranscript: string): TranscriptChunk[] {
  const { body } = extractVideoUrl(rawTranscript);
  const segments = parseSegments(body);
  if (!segments.length) return [];
  const utterances = segmentsToUtterances(segments);
  return utterancesToChunks(utterances);
}

export type LineExportItem = {
  video_name: string;
  video_url?: string;
  start_time?: string;
  end_time?: string;
  text: string;
};

const VIMEO_URL_IN_TEXT =
  /URL:\s*(https:\/\/vimeo\.com\/[^\s?]+(?:\/[^\s?]+)?(?:\?[^\s]*)?)/i;

/** Pull Vimeo link from caption footer lines (URL:… Name:…). */
export function extractVimeoUrlFromItems(items: LineExportItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const m = items[i]!.text.match(VIMEO_URL_IN_TEXT);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

/** Drop footer/metadata caption rows; fix placeholder video_url. */
export function normalizeCaptionExportItems(
  items: LineExportItem[]
): LineExportItem[] {
  const firstUrl = items[0]?.video_url?.trim() ?? '';
  const vimeo =
    extractVimeoUrlFromItems(items) ||
    (firstUrl.includes('vimeo.com') ? firstUrl : null);

  const resolved =
    vimeo && !vimeo.includes('example.com') ? vimeo : null;

  return items
    .filter((c) => {
      const t = c.text.trim();
      if (VIMEO_URL_IN_TEXT.test(t) && t.length < 280) return false;
      return t.length > 0;
    })
    .map((c) => ({
      ...c,
      video_url: resolved ?? '',
      text: stripCaptionLineNumber(c.text),
    }));
}

/** Caption line export: many tiny rows (SRT/Vimeo captions). */
export function isLineExportArray(items: LineExportItem[]): boolean {
  if (items.length < 20) return false;
  const avgLen =
    items.reduce((s, c) => s + (c.text?.length ?? 0), 0) / items.length;
  if (avgLen >= 120) return false;
  const zeroStart = items.filter((c) => c.start_time === '00:00').length;
  if (zeroStart / items.length > 0.75) return true;
  const hasMs = items.some((c) => /\.\d+$/.test(c.start_time ?? ''));
  return hasMs || items.length > 60;
}

function stripCaptionLineNumber(text: string): string {
  return text.replace(/\s+\d+$/, '').trim();
}

type CaptionLine = { text: string; startSec: number; endSec: number };

/** Merge line-by-line captions into overlapping RAG chunks; keeps real caption times. */
export function mergeLineExportToChunks(
  items: LineExportItem[]
): {
  video_name: string;
  video_url: string;
  start_time: string;
  end_time: string;
  text: string;
}[] {
  const video_name = items[0]!.video_name.trim();
  const video_url = items[0]!.video_url?.trim() ?? '';

  const captions: CaptionLine[] = items
    .map((c) => {
      const text = stripCaptionLineNumber(c.text);
      if (!text) return null;
      const startSec = parseTimestampToSeconds(c.start_time ?? '0');
      let endSec = parseTimestampToSeconds(c.end_time ?? c.start_time ?? '0');
      if (endSec <= startSec) endSec = startSec + 1;
      return { text, startSec, endSec };
    })
    .filter((c): c is CaptionLine => c !== null);

  const out: { startSec: number; endSec: number; text: string }[] = [];
  let buf: CaptionLine[] = [];

  const flush = (keepOverlap: boolean) => {
    const text = buf.map((b) => b.text).join(' ').trim();
    if (text.length < MIN_CHUNK_CHARS) {
      buf = keepOverlap ? buf.slice(-2) : [];
      return;
    }
    const startSec = buf[0]!.startSec;
    const endSec = buf[buf.length - 1]!.endSec;
    out.push({ startSec, endSec, text });
    if (keepOverlap) {
      const overlapLines = Math.max(2, Math.ceil(OVERLAP_CHARS / 45));
      buf = buf.slice(-overlapLines);
    } else {
      buf = [];
    }
  };

  for (const cap of captions) {
    buf.push(cap);
    const len = buf.map((b) => b.text).join(' ').length;
    if (len >= TARGET_CHARS) flush(true);
  }
  if (buf.length) flush(false);

  const url =
    video_url && !video_url.includes('example.com') ? video_url : '';

  return out.map((c) => {
    const item = {
      video_name,
      start_time: toMmSs(c.startSec),
      end_time: toMmSs(c.endSec),
      text: c.text,
    };
    return url ? { ...item, video_url: url } : item;
  });
}

export function chunksToExportItems(
  chunks: TranscriptChunk[],
  videoName: string,
  videoUrl: string
): {
  video_name: string;
  video_url?: string;
  start_time: string;
  end_time: string;
  text: string;
}[] {
  const url = videoUrl?.trim();
  const hasUrl = !!url && !url.includes('example.com');

  return chunks.map((c) => {
    const item = {
      video_name: videoName,
      start_time: toMmSs(c.startSec),
      end_time: toMmSs(c.endSec),
      text: c.text,
    };
    return hasUrl ? { ...item, video_url: url } : item;
  });
}
