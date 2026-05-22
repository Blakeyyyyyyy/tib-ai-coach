const EMBED_MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';
const EMBED_DIM = 1536;

async function fetchEmbeddings(
  texts: string[],
  apiKey: string
): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: texts,
      dimensions: EMBED_DIM,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embeddings failed: ${res.status} ${err}`);
  }
  const data = (await res.json()) as {
    data: { embedding: number[]; index: number }[];
  };
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

export async function embedTexts(
  texts: string[],
  apiKey: string
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const maxAttempts = 4;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchEmbeddings(texts, apiKey);
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, attempt * 3000));
      }
    }
  }
  throw lastErr;
}

export async function embedQuery(text: string, apiKey: string): Promise<number[]> {
  const [vec] = await embedTexts([text], apiKey);
  return vec;
}
