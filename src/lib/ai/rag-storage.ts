import type { RagSource } from '@/lib/types';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { embedQuery } from '@/lib/ai/openai-embed';
import { rerankIndicesWithOpenAI } from '@/lib/ai/rerank-openai';

type MatchRow = {
  id: string;
  content: string;
  source_title: string;
  source_url: string | null;
  resource_url: string | null;
  metadata: Record<string, unknown> | null;
  similarity: number;
};

function metaString(m: Record<string, unknown> | null, key: string): string | null {
  if (!m || typeof m[key] !== 'string') return null;
  const v = (m[key] as string).trim();
  return v || null;
}

function rowDocKey(row: MatchRow): string {
  const bucket =
    metaString(row.metadata, 'storage_bucket') ??
    process.env.RAG_STORAGE_BUCKET ??
    'Rag';
  const objectPath = metaString(row.metadata, 'storage_path');
  if (bucket && objectPath) return `${bucket}\0${objectPath}`;
  return `row:${row.id}`;
}

export type StorageRagResult = {
  contextBlock: string;
  sources: RagSource[];
};

export async function retrieveStorageRag(
  userQuery: string,
  openaiKey: string
): Promise<StorageRagResult | null> {
  try {
    return await retrieveStorageRagInner(userQuery, openaiKey);
  } catch (e) {
    console.error('retrieveStorageRag:', e);
    return null;
  }
}

async function retrieveStorageRagInner(
  userQuery: string,
  openaiKey: string
): Promise<StorageRagResult | null> {
  const threshold = parseFloat(process.env.RAG_MATCH_THRESHOLD ?? '0.22');
  const vectorMatchCount = parseInt(process.env.RAG_VECTOR_MATCH_COUNT ?? '28', 10);
  const afterRerank = parseInt(process.env.RAG_CONTEXT_CHUNKS ?? '6', 10);

  const singleSource =
    (process.env.RAG_SINGLE_SOURCE_PDF ?? 'true').toLowerCase() !== 'false';

  let embedding: number[];
  try {
    embedding = await embedQuery(userQuery, openaiKey);
  } catch (e) {
    console.error('RAG embed error:', e);
    return null;
  }

  const admin = createServiceRoleClient();
  const { data: rows, error } = await admin.rpc('match_knowledge_chunks', {
    query_embedding: embedding,
    match_threshold: Number.isFinite(threshold) ? threshold : 0.22,
    match_count: Number.isFinite(vectorMatchCount) ? vectorMatchCount : 28,
  });

  if (error) {
    console.error('match_knowledge_chunks:', error);
    return null;
  }

  const matches = (rows || []) as MatchRow[];
  if (matches.length === 0) return null;

  const passages = matches.map((m, i) => ({
    index: i,
    text: m.content,
  }));

  let order: number[];
  try {
    order = await rerankIndicesWithOpenAI(userQuery, passages, openaiKey);
  } catch (e) {
    console.error('RAG rerank error:', e);
    order = matches.map((_, i) => i);
  }

  /** Chunks fed to the model (rerank order, length capped). */
  let pick: MatchRow[];

  if (singleSource && order.length > 0) {
    const anchorKey = rowDocKey(matches[order[0]]);
    pick = [];
    for (const idx of order) {
      if (pick.length >= Math.max(1, afterRerank)) break;
      const row = matches[idx];
      if (rowDocKey(row) === anchorKey) {
        pick.push(row);
      }
    }
    if (pick.length === 0) {
      pick = [matches[order[0]]];
    }
  } else {
    pick = order.slice(0, Math.max(1, afterRerank)).map((i) => matches[i]);
  }

  const maxKbDefault = singleSource ? 1 : 12;
  const maxKbLinksRaw = parseInt(
    process.env.RAG_KNOWLEDGE_BASE_MAX_LINKS ?? String(maxKbDefault),
    10
  );
  const maxKbLinks =
    Number.isFinite(maxKbLinksRaw) && maxKbLinksRaw >= 1
      ? Math.min(maxKbLinksRaw, 20)
      : maxKbDefault;

  const sources: RagSource[] = [];
  const citedDocKeys = new Set<string>();
  const contextParts: string[] = [];

  for (const row of pick) {
    const bucket =
      metaString(row.metadata, 'storage_bucket') ??
      process.env.RAG_STORAGE_BUCKET ??
      'Rag';
    const objectPath = metaString(row.metadata, 'storage_path');

    const title =
      row.source_title ||
      objectPath?.split('/').pop()?.replace(/\.pdf$/i, '') ||
      'Knowledge base';

    const docKey = rowDocKey(row);

    if (!citedDocKeys.has(docKey)) {
      citedDocKeys.add(docKey);
      if (sources.length < maxKbLinks) {
        const proxyHref = `/api/rag/pdf?chunk_id=${encodeURIComponent(row.id)}`;
        sources.push({
          chunk_id: row.id,
          title,
          pdf_url: proxyHref,
          page_url: proxyHref,
          storage_bucket: bucket,
          storage_path: objectPath,
        });
      }
    }

    contextParts.push(`---\nSource: ${title}\n${row.content.trim()}`);
  }

  return {
    contextBlock: contextParts.join('\n\n'),
    sources,
  };
}

export function ragContextSystemAppendix(contextBlock: string): string {
  return `

INTERNAL KNOWLEDGE BASE (PDF excerpts from TiB materials — use when they genuinely help the answer; do not invent facts not supported here or by general coaching knowledge):

${contextBlock}

When you lean on these excerpts, keep the same JSON response shape as usual; do not paste raw URLs in "answer" — the app attaches source links separately.`;
}
