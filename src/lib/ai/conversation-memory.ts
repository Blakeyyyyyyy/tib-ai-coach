import { createServiceRoleClient } from '@/lib/supabase/service-role';

export type ChatTurn = { role: string; content: string };

const SUMMARY_SYSTEM = `You maintain a factual rolling summary of a Tradie in Business (TiB) AI coach conversation.
Return plain text only (no markdown fences). Use short bullet lines:
- Current topic: <one line — what they are discussing NOW>
- Business context: <size, trade, location if mentioned>
- Goals / problems: <brief>
- Decisions or advice given: <brief, no fluff>
- Open tasks: <titles only if any>

Rules:
- Be factual; do not invent.
- If the user changed topic in the latest messages, update Current topic to match the latest question.
- Max 400 words. Drop stale detail from older topics unless still relevant.`;

function summaryModel(): string {
  return process.env.CHAT_MEMORY_SUMMARY_MODEL?.trim() || 'gpt-4o-mini';
}

function recentMessageLimit(): number {
  const n = parseInt(process.env.CHAT_MEMORY_RECENT_MESSAGES ?? '16', 10);
  return Number.isFinite(n) && n >= 4 ? Math.min(n, 40) : 16;
}

function refreshEveryTurns(): number {
  const n = parseInt(process.env.CHAT_MEMORY_SUMMARY_REFRESH_EVERY ?? '6', 10);
  return Number.isFinite(n) && n >= 2 ? Math.min(n, 20) : 6;
}

export function buildMemorySystemAppendix(summary: string | null | undefined): string {
  if (!summary?.trim()) return '';
  return `

CONVERSATION MEMORY (summary of earlier turns — may be outdated if the user changed topic):
${summary.trim()}

If the latest user message changes topic, follow the latest message and INTERNAL KNOWLEDGE BASE excerpts over this summary.`;
}

/** Recent turns for the coach; older context should live in memory_summary. */
export function selectCoachMessages(
  messages: ChatTurn[],
  summary: string | null | undefined,
  maxHistoryFallback: number
): ChatTurn[] {
  const mapped = messages
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content.trim() : '',
    }))
    .filter((m) => m.content.length > 0 && (m.role === 'user' || m.role === 'assistant'));

  if (!summary?.trim()) {
    return mapped.slice(-maxHistoryFallback);
  }
  return mapped.slice(-recentMessageLimit());
}

export async function loadConversationMemory(
  conversationId: string | null | undefined,
  userId: string | null | undefined
): Promise<string | null> {
  if (!conversationId || !userId) return null;
  try {
    const admin = createServiceRoleClient();
    const { data, error } = await admin
      .from('conversations')
      .select('memory_summary')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.error('loadConversationMemory:', error.message);
      return null;
    }
    return data?.memory_summary?.trim() || null;
  } catch (e) {
    console.error('loadConversationMemory:', e);
    return null;
  }
}

function shouldRefreshSummary(
  messages: ChatTurn[],
  existingSummary: string | null
): boolean {
  if (!existingSummary) {
    return messages.filter((m) => m.role === 'user').length >= 3;
  }
  const assistantCount = messages.filter((m) => m.role === 'assistant').length;
  return assistantCount > 0 && assistantCount % refreshEveryTurns() === 0;
}

function formatTranscriptForSummary(messages: ChatTurn[], maxChars = 12000): string {
  const lines: string[] = [];
  let total = 0;
  for (const m of messages) {
    const line = `${m.role === 'user' ? 'User' : 'Coach'}: ${m.content}`;
    if (total + line.length > maxChars) break;
    lines.push(line);
    total += line.length;
  }
  return lines.join('\n\n');
}

export async function refreshConversationSummaryIfNeeded(
  conversationId: string | null | undefined,
  userId: string | null | undefined,
  messages: ChatTurn[],
  existingSummary: string | null
): Promise<void> {
  if (!conversationId || !userId) return;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return;
  if (!shouldRefreshSummary(messages, existingSummary)) return;

  const transcript = formatTranscriptForSummary(messages);
  if (transcript.length < 80) return;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: summaryModel(),
        max_tokens: 500,
        temperature: 0,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM },
          {
            role: 'user',
            content: `Previous summary:\n${existingSummary?.trim() || '(none)'}\n\nFull thread to update from:\n${transcript}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      console.error('summary refresh failed:', res.status, await res.text());
      return;
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text || text.length < 20) return;

    const admin = createServiceRoleClient();
    const { error } = await admin
      .from('conversations')
      .update({
        memory_summary: text,
        summary_updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)
      .eq('user_id', userId);
    if (error) console.error('save memory_summary:', error.message);
  } catch (e) {
    console.error('refreshConversationSummary:', e);
  }
}
