import { NextRequest, NextResponse } from 'next/server';
import {
  COACH_SYSTEM_PROMPT,
  parseAIResponse,
} from '@/lib/ai/coach';
import {
  retrieveStorageRag,
  ragContextSystemAppendix,
} from '@/lib/ai/rag-storage';

export async function POST(request: NextRequest) {
  try {
    const { messages, conversationId } = await request.json();

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'API key not configured' },
        { status: 500 }
      );
    }

    const anthropicMessages = messages.map(
      (m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })
    );

    let systemPrompt = COACH_SYSTEM_PROMPT;
    let ragSources: { chunk_id: string; title: string; pdf_url: string | null; page_url?: string | null }[] = [];

    const lastUser = [...messages]
      .reverse()
      .find((m: { role: string; content: string }) => m.role === 'user') as
      | { role: string; content: string }
      | undefined;

    if (
      lastUser?.content &&
      process.env.OPENAI_API_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      try {
        const rag = await retrieveStorageRag(
          lastUser.content,
          process.env.OPENAI_API_KEY
        );
        if (rag?.contextBlock) {
          systemPrompt += ragContextSystemAppendix(rag.contextBlock);
          ragSources = rag.sources;
        }
      } catch (e) {
        console.error('Storage RAG skipped:', e);
      }
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: systemPrompt,
        messages: anthropicMessages,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Anthropic API error:', error);
      return NextResponse.json(
        { error: 'Failed to get AI response' },
        { status: response.status }
      );
    }

    const data = await response.json();
    const rawContent = data.content[0]?.text || '';
    const parsed = parseAIResponse(rawContent);

    return NextResponse.json({
      ...parsed,
      rag_sources: ragSources,
      conversationId,
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
