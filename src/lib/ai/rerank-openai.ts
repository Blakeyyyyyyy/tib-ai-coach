/**
 * Document-aware reranking via OpenAI: orders chunk passages and flags irrelevant hits.
 */

const DEFAULT_MODEL = 'gpt-4o-mini';

export type RerankPassage = {
  index: number;
  text: string;
  /** PDF / source display name */
  title: string;
  /** Vector similarity from pgvector (0–1) */
  similarity: number;
};

export type RerankOutcome = {
  /** Passage indices, most relevant first */
  order: number[];
  /** Indices to exclude (off-topic or duplicate inferior hits) */
  drop: number[];
};

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function parseOutcome(
  raw: string,
  passages: RerankPassage[]
): RerankOutcome {
  const valid = new Set(passages.map((p) => p.index));
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      order: passages.map((p) => p.index),
      drop: [],
    };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      order?: unknown;
      drop?: unknown;
    };
    const dropSet = new Set<number>();
    if (Array.isArray(parsed.drop)) {
      for (const x of parsed.drop) {
        const n = typeof x === 'number' ? x : parseInt(String(x), 10);
        if (Number.isFinite(n) && valid.has(n)) dropSet.add(n);
      }
    }

    const seen = new Set<number>();
    const order: number[] = [];
    if (Array.isArray(parsed.order)) {
      for (const x of parsed.order) {
        const n = typeof x === 'number' ? x : parseInt(String(x), 10);
        if (!Number.isFinite(n) || !valid.has(n) || seen.has(n) || dropSet.has(n)) {
          continue;
        }
        seen.add(n);
        order.push(n);
      }
    }
    for (const p of passages) {
      if (!seen.has(p.index) && !dropSet.has(p.index)) {
        order.push(p.index);
      }
    }
    return { order, drop: [...dropSet] };
  } catch {
    return {
      order: passages.map((p) => p.index),
      drop: [],
    };
  }
}

/** @deprecated Use rerankPassagesWithOpenAI — kept for compatibility */
export async function rerankIndicesWithOpenAI(
  query: string,
  passages: { index: number; text: string }[],
  apiKey: string,
  model?: string
): Promise<number[]> {
  const enriched: RerankPassage[] = passages.map((p) => ({
    ...p,
    title: 'Unknown',
    similarity: 0,
  }));
  const { order } = await rerankPassagesWithOpenAI(query, enriched, apiKey, model);
  return order;
}

export async function rerankPassagesWithOpenAI(
  query: string,
  passages: RerankPassage[],
  apiKey: string,
  model = process.env.OPENAI_RERANK_MODEL ?? DEFAULT_MODEL
): Promise<RerankOutcome> {
  if (passages.length === 0) return { order: [], drop: [] };
  if (passages.length === 1) return { order: [passages[0].index], drop: [] };

  const body = passages
    .map((p) => {
      const sim =
        p.similarity > 0
          ? ` | vector=${p.similarity.toFixed(2)}`
          : '';
      return `[${p.index}] Document: "${truncate(p.title, 120)}"${sim}\n${truncate(p.text.replace(/\s+/g, ' ').trim(), 480)}`;
    })
    .join('\n\n---\n\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 512,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You rerank TiB trade-business coaching PDF excerpts for a user question.

Rules:
- Put the most on-topic passages first in "order" (use bracket indices only).
- Put clearly irrelevant or wrong-topic passages in "drop" (wrong playbook, different client plan, unrelated topic).
- If two passages are from the same document title, prefer the one that best answers the query; you may drop the weaker duplicate.
- Prefer documents whose title clearly matches the user's topic (e.g. cash flow → cash flow PDFs).
- For vague or broad questions where many playbooks partially match, pick ONE best document in "order" and put other documents' passages in "drop" unless the user clearly needs multiple topics.
- Passages marked EXACT PHRASE MATCH must rank first; never drop them in favour of a different document.
- Passages marked FULL-TEXT MATCH are strong keyword hits; rank them high unless clearly off-topic.
- "order" must only include relevant indices; omit irrelevant ones instead of listing them in order.

Reply JSON only: {"order":[int,...],"drop":[int,...]}`,
        },
        {
          role: 'user',
          content: `User question:\n${truncate(query, 900)}\n\nPassages:\n\n${body}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI rerank failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    choices: { message?: { content?: string } }[];
  };
  const raw = data.choices[0]?.message?.content?.trim() || '';
  return parseOutcome(raw, passages);
}
