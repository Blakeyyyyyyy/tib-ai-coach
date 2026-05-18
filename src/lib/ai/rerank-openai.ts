/**
 * Cross-encoder style reranking via OpenAI: model scores passage order for the query.
 */

const DEFAULT_MODEL = 'gpt-4o-mini';

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

export async function rerankIndicesWithOpenAI(
  query: string,
  passages: { index: number; text: string }[],
  apiKey: string,
  model = process.env.OPENAI_RERANK_MODEL ?? DEFAULT_MODEL
): Promise<number[]> {
  if (passages.length === 0) return [];
  if (passages.length === 1) return [passages[0].index];

  const body = passages
    .map(
      (p) =>
        `[${p.index}] ${truncate(p.text.replace(/\s+/g, ' ').trim(), 520)}`
    )
    .join('\n\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 256,
      messages: [
        {
          role: 'system',
          content:
            'You rank passages by relevance to the user query. Reply with JSON only: {"order":[...]} where "order" is the passage bracket indices (integers) from most to least relevant. Omit indices that are not relevant at all. No markdown, no explanation.',
        },
        {
          role: 'user',
          content: `Query:\n${truncate(query, 800)}\n\nPassages (use bracket numbers only):\n\n${body}`,
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
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return passages.map((p) => p.index);
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { order?: unknown };
    const order = parsed.order;
    if (!Array.isArray(order)) {
      return passages.map((p) => p.index);
    }
    const valid = new Set(passages.map((p) => p.index));
    const seen = new Set<number>();
    const out: number[] = [];
    for (const x of order) {
      const n = typeof x === 'number' ? x : parseInt(String(x), 10);
      if (!Number.isFinite(n) || !valid.has(n) || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    for (const p of passages) {
      if (!seen.has(p.index)) out.push(p.index);
    }
    return out;
  } catch {
    return passages.map((p) => p.index);
  }
}
