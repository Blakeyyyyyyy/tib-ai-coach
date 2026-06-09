import { NextRequest, NextResponse } from 'next/server';
import type { ChatRagPayload } from '@/lib/ai/chat-rag-payload';
import { buildRetrievalTopicHint } from '@/lib/ai/rag-rewrite-gate';
import {
  loadConversationMemory,
} from '@/lib/ai/conversation-memory';
import { retrieveStorageRag } from '@/lib/ai/rag-storage';
import { createClient } from '@/lib/supabase/server';

/** Step 1 of split coach flow — knowledge retrieval only (fits Netlify function budget). */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as {
      query?: string;
      conversationId?: string | null;
    };
    const query = body.query?.trim();
    if (!query) {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }

    const openaiKey = process.env.OPENAI_API_KEY?.trim();
    if (!openaiKey || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      return NextResponse.json({ rag: null });
    }

    const memorySummary = await loadConversationMemory(
      body.conversationId,
      user.id
    );
    const topicHint = buildRetrievalTopicHint(memorySummary, query);

    let rag: ChatRagPayload | null = null;
    try {
      const result = await retrieveStorageRag(query, openaiKey, { topicHint });
      if (result?.contextBlock) {
        rag = {
          contextBlock: result.contextBlock,
          sources: result.sources,
          primarySourceTitle: result.primarySourceTitle,
          queryIntent: result.queryIntent,
          answerGuidance: result.answerGuidance,
        };
      }
    } catch (e) {
      console.error('RAG retrieve error:', e);
    }

    return NextResponse.json({ rag });
  } catch (error) {
    console.error('RAG retrieve API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
