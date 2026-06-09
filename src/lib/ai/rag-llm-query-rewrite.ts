import type { RagQueryIntent } from '@/lib/ai/rag-query-mode';
import {
  classifyRetrievalMode,
  shouldRunKeywordExpansion,
} from '@/lib/ai/rag-retrieval-mode';
import {
  computeRewriteGate,
  type RewriteGateResult,
  type RewriteMode,
} from '@/lib/ai/rag-rewrite-gate';

export type RagLlmRewrite = {
  /** Short keyword phrases for parallel vector embed (2–6 words each). */
  keywordExpansions: string[];
  /** Heuristic session angles from topic catalog — keyword embeds only. */
  searchQueries: string[];
  speakerHints: string[];
  topicPhrases: string[];
};

export type RagRewriteMeta = {
  gate: RewriteGateResult;
  mode: RewriteMode;
  topicHintUsed: boolean;
};

const EXPANSION_SYSTEM = (maxKeywords: number) => `You help search a Tradie in Business (TiB) coaching knowledge base of video transcripts and PDFs.
Return ONLY valid JSON with:
- keyword_expansions: ${maxKeywords} SHORT keyword phrases (2-6 words each). NOT full sentences. TiB vocabulary only. Distinct angles on the user's question.
- topic_phrases: 2-5 exact phrases worth literal text search (e.g. "cash flow forecast", "slow months")
- speaker_hints: likely speaker first names if clearly implied (e.g. Rhys, Jackson), else []

Do NOT return search_queries or rewrite the user question as a sentence.

Rules for keyword_expansions:
- Use noun phrases and TiB terms: "cash flow forecast", "debtor chasing", "slow season tradie"
- Never invent quotes, session titles, or facts
- July / FY optimism → keywords like "most hopeful financial year", "Two Drunk Accountants" — NOT "Get Ready for EOFY" unless user asks EOFY
- Website traffic no calls → "Rhys Kaha Digital", "website traffic phone calls"
- If "Active topic" is provided, include 1-2 keywords aligned with that topic plus keywords from the question`;

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

function parseKeywordExpansionPayload(
  parsed: Record<string, unknown>,
  maxKeywords: number
): RagLlmRewrite | null {
  const keywordExpansions = asStringArray(
    parsed.keyword_expansions ?? parsed.search_queries,
    maxKeywords
  );
  const speakerHints = asStringArray(parsed.speaker_hints, 4);
  const topicPhrases = asStringArray(parsed.topic_phrases, 8);

  if (keywordExpansions.length === 0 && topicPhrases.length === 0) return null;

  return {
    keywordExpansions,
    searchQueries: [],
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

async function llmKeywordExpansionWithOpenAI(
  userQuery: string,
  maxKeywords: number,
  topicHint?: string | null
): Promise<RagLlmRewrite | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const model =
    process.env.RAG_LLM_REWRITE_MODEL?.trim() || 'gpt-4o-mini';
  const timeoutMs = parseInt(process.env.RAG_LLM_REWRITE_TIMEOUT_MS ?? '15000', 10) || 15000;
  const maxTokens = maxKeywords <= 3 ? 220 : 360;

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
        { role: 'system', content: EXPANSION_SYSTEM(maxKeywords) },
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
  return parseKeywordExpansionPayload(parsed, maxKeywords);
}

async function llmKeywordExpansionWithAnthropic(
  userQuery: string,
  maxKeywords: number,
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
      max_tokens: maxKeywords <= 3 ? 220 : 360,
      temperature: 0,
      system: EXPANSION_SYSTEM(maxKeywords),
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
  return parseKeywordExpansionPayload(parsed, maxKeywords);
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

  const retrievalMode = classifyRetrievalMode(userQuery);
  if (
    retrievalMode !== 'vague' ||
    !shouldRunKeywordExpansion(retrievalMode) ||
    gate.mode === 'off' ||
    rewriteProvider() === 'none'
  ) {
    return { rewrite: null, meta };
  }

  const maxKeywords = Math.min(
    Math.max(
      parseInt(process.env.RAG_LLM_KEYWORD_EXPANSIONS ?? '5', 10) || 5,
      2
    ),
    6
  );

  try {
    const provider = rewriteProvider();
    let rewrite: RagLlmRewrite | null = null;
    if (provider === 'openai') {
      rewrite = await llmKeywordExpansionWithOpenAI(
        userQuery,
        maxKeywords,
        topicHint
      );
    } else if (provider === 'anthropic') {
      rewrite = await llmKeywordExpansionWithAnthropic(
        userQuery,
        maxKeywords,
        topicHint
      );
    }
    return { rewrite, meta };
  } catch (e) {
    console.error('RAG LLM rewrite error:', e);
    return { rewrite: null, meta };
  }
}

/** Soft expansion without LLM — topic hint as keywords, not a merged sentence. */
export function softRewriteFromTopicHint(
  _userQuery: string,
  topicHint: string | null | undefined
): RagLlmRewrite | null {
  if (!topicHint?.trim()) return null;
  const hint = topicHint.trim().slice(0, 120);
  const words = hint
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .slice(0, 4);
  return {
    keywordExpansions: words.length > 0 ? words : [hint],
    searchQueries: [],
    speakerHints: [],
    topicPhrases: [hint],
  };
}
