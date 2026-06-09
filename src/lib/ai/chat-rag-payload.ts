import { ragContextSystemAppendix } from '@/lib/ai/rag-storage';
import type { RagQueryIntent } from '@/lib/ai/rag-query-mode';
import type { RagSource } from '@/lib/types';

/** RAG context passed from /api/rag/retrieve into /api/chat (split Netlify requests). */
export type ChatRagPayload = {
  contextBlock: string;
  sources: RagSource[];
  primarySourceTitle: string | null;
  queryIntent: RagQueryIntent | null;
  answerGuidance: string | null;
};

export function applyRagPayloadToSystem(
  baseSystemPrompt: string,
  payload: ChatRagPayload | null | undefined
): { systemPrompt: string; sources: RagSource[] } {
  if (!payload?.contextBlock?.trim()) {
    return { systemPrompt: baseSystemPrompt, sources: payload?.sources ?? [] };
  }

  return {
    systemPrompt:
      baseSystemPrompt +
      ragContextSystemAppendix(
        payload.contextBlock,
        payload.primarySourceTitle,
        payload.queryIntent,
        payload.answerGuidance ?? undefined
      ),
    sources: payload.sources ?? [],
  };
}
