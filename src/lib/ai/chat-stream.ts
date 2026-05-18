import type { AIResponse, RagSource } from '@/lib/types';

export type ChatStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'meta'; rag_sources: RagSource[] }
  | { type: 'delta'; text: string }
  | { type: 'done'; parsed: AIResponse; conversationId?: string }
  | { type: 'error'; error: string };

export function encodeChatStreamEvent(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

/** Parse newline-delimited JSON events from the chat API response body. */
export function parseChatStreamLine(line: string): ChatStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as ChatStreamEvent;
  } catch {
    return null;
  }
}

type AnthropicSsePayload = {
  type?: string;
  delta?: { type?: string; text?: string };
};

/** Consume Anthropic `stream: true` SSE; returns leftover buffer. */
export function consumeAnthropicSse(
  buffer: string,
  onTextDelta: (text: string) => void
): string {
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() ?? '';

  for (const block of blocks) {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;
      let data: AnthropicSsePayload;
      try {
        data = JSON.parse(payload) as AnthropicSsePayload;
      } catch {
        continue;
      }
      if (
        data.type === 'content_block_delta' &&
        data.delta?.type === 'text_delta' &&
        typeof data.delta.text === 'string'
      ) {
        onTextDelta(data.delta.text);
      }
    }
  }

  return rest;
}
