import { NextRequest, NextResponse } from 'next/server';
import {
  COACH_SYSTEM_PROMPT,
  parseAIResponse,
} from '@/lib/ai/coach';
import {
  encodeChatStreamEvent,
  consumeAnthropicSse,
} from '@/lib/ai/chat-stream';
import {
  retrieveStorageRag,
  ragContextSystemAppendix,
} from '@/lib/ai/rag-storage';
import { buildRetrievalTopicHint } from '@/lib/ai/rag-rewrite-gate';
import {
  buildMemorySystemAppendix,
  loadConversationMemory,
  refreshConversationSummaryIfNeeded,
  selectCoachMessages,
} from '@/lib/ai/conversation-memory';
import { createClient } from '@/lib/supabase/server';
import type { RagSource } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { messages, conversationId } = await request.json();

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'API key not configured' },
        { status: 500 }
      );
    }

    const maxHistoryRaw = parseInt(
      process.env.CHAT_MAX_HISTORY_MESSAGES ?? '20',
      10
    );
    const maxHistory =
      Number.isFinite(maxHistoryRaw) && maxHistoryRaw >= 2
        ? Math.min(maxHistoryRaw, 40)
        : 20;

    const chatMessages = messages as { role: string; content: string }[];
    const memorySummary = await loadConversationMemory(conversationId, user.id);

    const anthropicMessages = selectCoachMessages(
      chatMessages,
      memorySummary,
      maxHistory
    );

    let systemPrompt =
      COACH_SYSTEM_PROMPT + buildMemorySystemAppendix(memorySummary);
    let ragSources: RagSource[] = [];

    const lastUser = [...chatMessages]
      .reverse()
      .find((m) => m.role === 'user') as
      | { role: string; content: string }
      | undefined;

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: Parameters<typeof encodeChatStreamEvent>[0]) => {
          controller.enqueue(encodeChatStreamEvent(event));
        };

        try {
          if (
            lastUser?.content &&
            process.env.OPENAI_API_KEY &&
            process.env.SUPABASE_SERVICE_ROLE_KEY
          ) {
            send({ type: 'status', message: 'Searching knowledge base…' });
            try {
              const topicHint = buildRetrievalTopicHint(
                memorySummary,
                lastUser.content
              );
              const rag = await retrieveStorageRag(
                lastUser.content,
                process.env.OPENAI_API_KEY,
                { topicHint }
              );
              if (rag?.contextBlock) {
                systemPrompt += ragContextSystemAppendix(
                  rag.contextBlock,
                  rag.primarySourceTitle,
                  rag.queryIntent,
                  rag.answerGuidance ?? undefined
                );
                ragSources = rag.sources;
              }
            } catch (e) {
              console.error('Storage RAG skipped:', e);
            }
          }

          send({ type: 'meta', rag_sources: ragSources });
          send({ type: 'status', message: 'Writing your answer…' });

          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': process.env.ANTHROPIC_API_KEY!,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: (() => {
                const n = parseInt(
                  process.env.CHAT_MAX_OUTPUT_TOKENS ?? '1500',
                  10
                );
                return Number.isFinite(n) && n >= 256 ? Math.min(n, 4096) : 1500;
              })(),
              stream: true,
              system: systemPrompt,
              messages: anthropicMessages,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('Anthropic API error:', errorText);
            let detail = 'Failed to get AI response';
            try {
              const j = JSON.parse(errorText) as { error?: { message?: string } };
              if (j?.error?.message) detail = j.error.message;
            } catch {
              /* use default */
            }
            send({ type: 'error', error: detail });
            controller.close();
            return;
          }

          if (!response.body) {
            send({ type: 'error', error: 'No response stream from AI' });
            controller.close();
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let sseBuffer = '';
          let fullText = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });
            sseBuffer = consumeAnthropicSse(sseBuffer, (text) => {
              fullText += text;
              send({ type: 'delta', text });
            });
          }

          sseBuffer += decoder.decode();
          consumeAnthropicSse(`${sseBuffer}\n\n`, (text) => {
            fullText += text;
            send({ type: 'delta', text });
          });

          const parsed = parseAIResponse(fullText);
          if (ragSources.length > 0) {
            parsed.rag_sources = ragSources;
          }

          send({
            type: 'done',
            parsed,
            conversationId,
          });

          void refreshConversationSummaryIfNeeded(
            conversationId,
            user.id,
            chatMessages,
            memorySummary
          );

          controller.close();
        } catch (e) {
          console.error('Chat stream error:', e);
          send({ type: 'error', error: 'Internal server error' });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
