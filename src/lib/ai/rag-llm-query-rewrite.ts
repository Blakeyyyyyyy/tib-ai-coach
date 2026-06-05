import type { RagQueryIntent } from '@/lib/ai/rag-query-mode';
import {
  computeRewriteGate,
  type RewriteGateResult,
  type RewriteMode,
} from '@/lib/ai/rag-rewrite-gate';

export type RagLlmRewrite = {
  searchQueries: string[];
  speakerHints: string[];
  topicPhrases: string[];
};

export type RagRewriteMeta = {
  gate: RewriteGateResult;
  mode: RewriteMode;
  topicHintUsed: boolean;
};

const REWRITE_SYSTEM = (maxQueries: number) => `You help search a Tradie in Business (TiB) coaching knowledge base of video transcripts and PDFs.
Return ONLY valid JSON with:
- search_queries: ${maxQueries} short alternative search strings (distinct angles) using TiB vocabulary. Do not invent quotes or facts.
- speaker_hints: likely speaker first names if implied (e.g. Rhys, Jackson), else []
- topic_phrases: 2-6 exact phrases worth literal text search (e.g. "most hopeful time of the year")

Rules:
- July / new financial year optimism → prefer "Financial Jam" / "Two Drunk Accountants", NOT generic "Get Ready for EOFY" unless the user asks about EOFY prep.
- Website traffic but no calls → Rhys / Kaha Digital marketing.
- Apprentice + systems/checklist → Systemology Expert Session.
- Kitchen + warranty story → Momentum Meet Tara kitchen warranty (not random Momentum dates).
- If an "Active topic" line is provided and the user question is vague, bias search_queries toward that topic without ignoring the question.`;

function rewriteProvider(): 'openai' | 'anthropic' | 'none' {
  const pref = process.env.RAG_LLM_REWRITE_PROVIDER?.trim().toLowerCase();
  const hasOpenai = Boolean(process.env.OPENAI_API_KEY?.trim());
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  if (pref === 'anthropic' && hasAnthropic) return 'anthropic';
  if (pref === 'openai' && hasOpenai) return 'openai';
  if (hasOpenai) return 'openai';
  if (hasAnthropic) return 'anthropic';
  return 'none';
}

/** @deprecated Use computeRewriteGate — kept for tests/scripts. */
export function shouldUseLlmQueryRewrite(
  userQuery: string,
  intent?: RagQueryIntent
): boolean {
  void intent;
  const gate = computeRewriteGate(userQuery);
  return gate.mode !== 'off' && rewriteProvider() !== 'none';
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]!.trim() : trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in LLM rewrite');
  return JSON.parse(body.slice(start, end + 1));
}

function asStringArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const s = item.replace(/\s+/g, ' ').trim();
    if (s.length < 3) continue;
    if (!out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function parseRewritePayload(
  parsed: Record<string, unknown>,
  userQuery: string,
  maxQueries: number
): RagLlmRewrite | null {
  const searchQueries = asStringArray(parsed.search_queries, maxQueries);
  const speakerHints = asStringArray(parsed.speaker_hints, 4);
  const topicPhrases = asStringArray(parsed.topic_phrases, 8);

  if (searchQueries.length === 0 && topicPhrases.length === 0) return null;

  return {
    searchQueries:
      searchQueries.length > 0
        ? searchQueries
        : [userQuery.trim().slice(0, 200)],
    speakerHints,
    topicPhrases,
  };
}

function buildRewriteUserPrompt(userQuery: string, topicHint?: string | null): string {
  const parts = [`User question:\n${userQuery.trim()}`];
  if (topicHint?.trim()) {
    parts.push(
      `\nActive topic from earlier conversation (use ONLY if the question is vague):\n${topicHint.trim()}`
    );
  }
  parts.push('\nJSON:');
  return parts.join('');
}

async function llmRewriteWithOpenAI(
  userQuery: string,
  maxQueries: number,
  topicHint?: string | null
): Promise<RagLlmRewrite | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const model =
    process.env.RAG_LLM_REWRITE_MODEL?.trim() || 'gpt-4o-mini';
  const timeoutMs = parseInt(process.env.RAG_LLM_REWRITE_TIMEOUT_MS ?? '15000', 10) || 15000;
  const maxTokens = maxQueries <= 1 ? 220 : 400;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: REWRITE_SYSTEM(maxQueries) },
        {
          role: 'user',
          content: buildRewriteUserPrompt(userQuery, topicHint),
        },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    console.error('RAG OpenAI rewrite failed:', res.status, await res.text());
    return null;
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content ?? '';
  const parsed = extractJsonObject(text) as Record<string, unknown>;
  return parseRewritePayload(parsed, userQuery, maxQueries);
}

async function llmRewriteWithAnthropic(
  userQuery: string,
  maxQueries: number,
  topicHint?: string | null
): Promise<RagLlmRewrite | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;

  const model =
    process.env.RAG_LLM_REWRITE_MODEL?.trim() || 'claude-sonnet-4-20250514';
  const timeoutMs = parseInt(process.env.RAG_LLM_REWRITE_TIMEOUT_MS ?? '25000', 10) || 25000;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxQueries <= 1 ? 220 : 400,
      temperature: 0,
      system: REWRITE_SYSTEM(maxQueries),
      messages: [
        {
          role: 'user',
          content: buildRewriteUserPrompt(userQuery, topicHint),
        },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    console.error('RAG Anthropic rewrite failed:', res.status, await res.text());
    return null;
  }

  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
  const parsed = extractJsonObject(text) as Record<string, unknown>;
  return parseRewritePayload(parsed, userQuery, maxQueries);
}

export type RagRewriteRequest = {
  userQuery: string;
  gate?: RewriteGateResult;
  topicHint?: string | null;
};

export async function llmRewriteQueriesForRag(
  request: RagRewriteRequest | string
): Promise<{ rewrite: RagLlmRewrite | null; meta: RagRewriteMeta }> {
  const userQuery =
    typeof request === 'string' ? request : request.userQuery;
  const gate =
    typeof request === 'string'
      ? computeRewriteGate(userQuery)
      : (request.gate ?? computeRewriteGate(userQuery));
  const topicHint =
    typeof request === 'string' ? null : (request.topicHint ?? null);

  const meta: RagRewriteMeta = {
    gate,
    mode: gate.mode,
    topicHintUsed: Boolean(topicHint?.trim()),
  };

  if (gate.mode === 'off' || rewriteProvider() === 'none') {
    return { rewrite: null, meta };
  }

  const maxQueries =
    gate.mode === 'soft'
      ? 1
      : Math.min(
          Math.max(
            parseInt(process.env.RAG_LLM_REWRITE_MAX_QUERIES ?? '3', 10) || 3,
            1
          ),
          4
        );

  try {
    const provider = rewriteProvider();
    let rewrite: RagLlmRewrite | null = null;
    if (provider === 'openai') {
      rewrite = await llmRewriteWithOpenAI(userQuery, maxQueries, topicHint);
    } else if (provider === 'anthropic') {
      rewrite = await llmRewriteWithAnthropic(userQuery, maxQueries, topicHint);
    }
    return { rewrite, meta };
  } catch (e) {
    console.error('RAG LLM rewrite error:', e);
    return { rewrite: null, meta };
  }
}

/** Soft rewrite without LLM — topic hint as a single search angle. */
export function softRewriteFromTopicHint(
  userQuery: string,
  topicHint: string | null | undefined
): RagLlmRewrite | null {
  if (!topicHint?.trim()) return null;
  const q = userQuery.trim();
  return {
    searchQueries: [`${topicHint.trim()} ${q}`.slice(0, 200)],
    speakerHints: [],
    topicPhrases: [topicHint.trim().slice(0, 120)],
  };
}
