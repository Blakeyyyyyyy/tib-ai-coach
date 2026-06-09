/** Pause between batch RAG tests to avoid Cohere trial rate limits (10/min). */
export async function ragTestThrottle(index: number): Promise<void> {
  if (index <= 0) return;
  const ms = parseInt(process.env.RAG_TEST_DELAY_MS ?? '6500', 10) || 0;
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}
