/**
 * One embedded "session card" per video/PDF — helps retrieval pick the right document
 * before reading individual chunks.
 */

import { QUERY_STOPWORDS } from '@/lib/ai/rag-query-terms';

const TOPIC_WORD_LIMIT = 14;
const PREVIEW_CHAR_LIMIT = 1200;

function tokenizeForTopics(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length >= 4 && !QUERY_STOPWORDS.has(w));
}

/** Frequent meaningful words from transcript/PDF text (session topics). */
export function extractTopicKeywords(text: string, max = TOPIC_WORD_LIMIT): string[] {
  const freq = new Map<string, number>();
  for (const w of tokenizeForTopics(text)) {
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, max)
    .map(([w]) => w);
}

export function buildVideoSessionCardContent(opts: {
  sessionTitle: string;
  sourceFile: string;
  videoName: string;
  videoUrl?: string | null;
  segmentTexts: string[];
}): string {
  const preview = opts.segmentTexts
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PREVIEW_CHAR_LIMIT);

  const topics = extractTopicKeywords(preview);
  const lines = [
    'TiB VIDEO SESSION CARD',
    `Session: ${opts.sessionTitle}`,
    `Source file: ${opts.sourceFile}`,
    `Video name: ${opts.videoName}`,
  ];
  if (opts.videoUrl) lines.push(`Video URL: ${opts.videoUrl}`);
  if (topics.length) lines.push(`Topics: ${topics.join(', ')}`);
  if (preview) lines.push('', 'Opening content:', preview);
  return lines.join('\n');
}

export function buildPdfSessionCardContent(opts: {
  title: string;
  storagePath: string;
  bucket: string;
  chunkTexts: string[];
}): string {
  const preview = opts.chunkTexts
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PREVIEW_CHAR_LIMIT);

  const topics = extractTopicKeywords(preview);
  const lines = [
    'TiB PDF SESSION CARD',
    `Document: ${opts.title}`,
    `Storage path: ${opts.storagePath}`,
    `Bucket: ${opts.bucket}`,
  ];
  if (topics.length) lines.push(`Topics: ${topics.join(', ')}`);
  if (preview) lines.push('', 'Summary excerpt:', preview);
  return lines.join('\n');
}

export function isSessionCardRow(
  metadata: Record<string, unknown> | null
): boolean {
  return (
    metadata != null &&
    typeof metadata.source_type === 'string' &&
    metadata.source_type === 'session_card'
  );
}
