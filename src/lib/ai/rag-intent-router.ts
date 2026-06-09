/**
 * Step 2 — routeIntent: LLM classifies coaching intents + keyword phrases.
 * Falls back to regex topic catalog when confidence is low.
 */

import {
  getTopicById,
  RAG_TOPIC_CATALOG,
  scoreTopicsForQuery,
} from '@/lib/ai/rag-topic-catalog';
import { classifyRetrievalMode } from '@/lib/ai/rag-retrieval-mode';
import { extractExplicitSessionTitle } from '@/lib/ai/rag-explicit-session';

export type RagIntentRoute = {
  intents: string[];
  keywords: string[];
  entities: string[];
  confidence: number;
  source: 'llm' | 'regex' | 'skipped';
};

const INTENT_MIN_CONFIDENCE = parseEnvFloat(
  process.env.RAG_INTENT_MIN_CONFIDENCE,
  0.7
);

function parseEnvFloat(value: string | undefined, fallback: number): number {
  const n = parseFloat(value ?? String(fallback));
  return Number.isFinite(n) ? n : fallback;
}

export function intentRouterEnabled(): boolean {
  if ((process.env.RAG_INTENT_ROUTER ?? 'true').toLowerCase() === 'false') {
    return false;
  }
  return Boolean(
    process.env.OPENAI_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim()
  );
}

function topicIdsForRouter(): string[] {
  return RAG_TOPIC_CATALOG.map((t) => t.id);
}

function buildIntentSystemPrompt(): string {
  const ids = topicIdsForRouter().join(', ');
  return `You route Tradie in Business (TiB) coaching questions to knowledge-base topic IDs.
Return ONLY valid JSON:
{
  "intents": ["topic_id", ...],
  "keywords": ["short phrase", ...],
  "entities": ["name or session", ...],
  "confidence": 0.0
}

Allowed intent IDs (pick 0-2 best matches): ${ids}

Rules:
- intents must use IDs from the list only
- keywords: 3-6 short TiB search phrases (2-6 words), NOT full sentences
- entities: people, brands, or explicit session names only
- confidence: 0-1 how sure the intent mapping is
- Use general_business only when nothing else fits (not in list — use empty intents instead)
- July FY optimism → fy_hopeful or drunk_accountants, NOT eofy_webinar unless user asks EOFY
- Write job ad / recruit apprentice ad copy → hire_apprentice or pdf_hiring_cheat (Sexy Job Ad)
- Screening questions / hire first apprentice process → hire_apprentice (HR for Tradies) NOT job ad
- Losing money / pricing / margins → job_pricing_margin
- Bank balance vs cash flow accounting → cash_bank_balance NOT cashflow_slow_months
- Slow quiet months cash gap → cashflow_slow_months
- July optimistic new FY → fy_hopeful or drunk_accountants NOT eofy_webinar
- EOFY webinar checklist before 30 June → eofy_webinar
- Too expensive quote objection script → pdf_price_objection
- Charge for quotes / qualifying clients → charge_quotes
- Stuck on tools / delegate (no Critical Alignment) → joe_delegation (Get Off the Tools)
- Offshore VA / virtual assistant + delegation / English second language → offshore_va_delegation (Momentum Meet March 4)
- Critical Alignment Model / Dani Ferrier delegation session → dani_ferrier_delegation
- Apprentice ignores checklist / systems stick → systemology NOT systems_where_to_start`;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]!.trim() : trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON in intent router');
  return JSON.parse(body.slice(start, end + 1));
}

function asStringArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const s = item.replace(/\s+/g, ' ').trim();
    if (s.length < 2) continue;
    if (!out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function parseLlmIntentPayload(parsed: Record<string, unknown>): RagIntentRoute | null {
  const rawIntents = asStringArray(parsed.intents, 3);
  const intents = rawIntents.filter((id) => getTopicById(id) != null);
  const keywords = asStringArray(parsed.keywords, 6);
  const entities = asStringArray(parsed.entities, 4);
  const confRaw = parsed.confidence;
  const confidence =
    typeof confRaw === 'number' && Number.isFinite(confRaw)
      ? Math.min(1, Math.max(0, confRaw))
      : intents.length > 0
        ? 0.65
        : 0.3;

  if (intents.length === 0 && keywords.length === 0 && entities.length === 0) {
    return null;
  }

  return { intents, keywords, entities, confidence, source: 'llm' };
}

function regexIntentFallback(userQuery: string): RagIntentRoute {
  const ranked = scoreTopicsForQuery(userQuery);
  const top = ranked[0];
  const second = ranked[1]?.score ?? 0;
  const intents = top && top.score > 0 ? [top.id] : [];
  const margin = top ? top.score - second : 0;
  const confidence = top
    ? Math.min(0.85, top.score + margin * 0.35)
    : 0;

  return {
    intents,
    keywords: [],
    entities: extractExplicitSessionTitle(userQuery)
      ? [extractExplicitSessionTitle(userQuery)!]
      : [],
    confidence,
    source: 'regex',
  };
}

async function routeIntentWithOpenAI(
  userQuery: string,
  topicHint?: string | null
): Promise<RagIntentRoute | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const model = process.env.RAG_INTENT_ROUTER_MODEL?.trim() || 'gpt-4o-mini';
  const timeoutMs =
    parseInt(process.env.RAG_INTENT_ROUTER_TIMEOUT_MS ?? '12000', 10) || 12000;

  const userParts = [`User question:\n${userQuery.trim()}`];
  if (topicHint?.trim()) {
    userParts.push(`\nConversation topic hint:\n${topicHint.trim()}`);
  }
  userParts.push('\nJSON:');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 280,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildIntentSystemPrompt() },
        { role: 'user', content: userParts.join('') },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    console.error('RAG intent router failed:', res.status);
    return null;
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content ?? '';
  const parsed = extractJsonObject(text) as Record<string, unknown>;
  return parseLlmIntentPayload(parsed);
}

/** Step 2 — classify intents; regex fallback when LLM off or low confidence. */
export async function routeQueryIntent(
  userQuery: string,
  topicHint?: string | null
): Promise<RagIntentRoute> {
  const mode = classifyRetrievalMode(userQuery);
  if (mode === 'explicit_session') {
    const explicit = extractExplicitSessionTitle(userQuery);
    return {
      intents: [],
      keywords: [],
      entities: explicit ? [explicit] : [],
      confidence: 1,
      source: 'skipped',
    };
  }

  if (!intentRouterEnabled()) {
    return regexIntentFallback(userQuery);
  }

  try {
    const llm = await routeIntentWithOpenAI(userQuery, topicHint);
    if (llm && llm.confidence >= INTENT_MIN_CONFIDENCE && llm.intents.length > 0) {
      return llm;
    }
    const fallback = regexIntentFallback(userQuery);
    if (llm && llm.keywords.length > 0) {
      return {
        ...fallback,
        keywords: llm.keywords,
        entities: [...new Set([...fallback.entities, ...llm.entities])],
        confidence: Math.max(fallback.confidence, llm.confidence * 0.85),
        source: 'regex',
      };
    }
    return fallback;
  } catch (e) {
    console.error('routeQueryIntent:', e);
    return regexIntentFallback(userQuery);
  }
}

/** Merge intent router keywords into rewrite expansion (step 4). */
export function intentKeywordsForRewrite(
  intentRoute: RagIntentRoute | null
): { keywordExpansions: string[]; topicPhrases: string[] } {
  if (!intentRoute) return { keywordExpansions: [], topicPhrases: [] };
  return {
    keywordExpansions: intentRoute.keywords.slice(0, 6),
    topicPhrases: intentRoute.keywords.filter((k) => k.split(/\s+/).length >= 2).slice(0, 4),
  };
}
