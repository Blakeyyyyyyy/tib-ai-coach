/**
 * Classify user questions so RAG + coach adapt (factual, reasoning, compare, coaching).
 * Works for any question type — not only short factual ones.
 */

export type RagQueryIntent = 'factual' | 'reasoning' | 'comparison' | 'coaching';

export type RagIntentParams = {
  intent: RagQueryIntent;
  maxDocs: number;
  maxKbLinks: number;
  singleSource: boolean;
  answerGuidance: string;
};

export function classifyRagQueryIntent(userQuery: string): RagQueryIntent {
  const q = userQuery.replace(/\s+/g, ' ').trim();
  const lower = q.toLowerCase();
  const words = q.split(/\s+/).filter(Boolean).length;

  if (
    /\b(compare|comparison|versus|vs\.?|difference between|differ from|better between|which is better|pros and cons)\b/i.test(
      q
    )
  ) {
    return 'comparison';
  }

  if (
    /\b(help me|how do i|how can i|what should i|action plan|roadmap|fix my|improve my|grow my|hire|cash flow plan|marketing plan|my goal|break down|next actions?)\b/i.test(
      q
    ) &&
    words >= 6
  ) {
    return 'coaching';
  }

  if (
    /\b(why|reason|because|assume|implies|what does that mean|what would that mean|how does .+ relate|if .+ then|logical|therefore|so does that mean)\b/i.test(
      q
    ) ||
    (/\b(how|what)\b/i.test(q) && /\b(work|mean|assume|learn|change)\b/i.test(q) && words >= 12)
  ) {
    return 'reasoning';
  }

  if (
    words <= 20 &&
    /\b(what|who|when|where|which|define|does .+ say|according to|from .+ session)\b/i.test(
      q
    )
  ) {
    return 'factual';
  }

  if (words <= 14) return 'factual';

  if (words >= 28) return 'coaching';

  return 'reasoning';
}

export function ragParamsForIntent(intent: RagQueryIntent): Omit<RagIntentParams, 'intent'> {
  switch (intent) {
    case 'factual':
      return {
        maxDocs: 1,
        maxKbLinks: 1,
        singleSource: true,
        answerGuidance:
          'Give a direct, exact answer in a few sentences. Quote or closely paraphrase the primary source. One source in Knowledge base.',
      };
    case 'reasoning':
      return {
        maxDocs: 2,
        maxKbLinks: 1,
        singleSource: false,
        answerGuidance:
          'Answer the why/how using clear logic, but every claim must be supported by the excerpts. Briefly connect ideas (e.g. "Because the session says X, that implies Y for tradies"). Stay grounded — no invented psychology or theory not in the text. Cite the primary source; use a second source only if excerpts require it.',
      };
    case 'comparison':
      return {
        maxDocs: 2,
        maxKbLinks: 2,
        singleSource: false,
        answerGuidance:
          'Compare only what the excerpts actually say. Structure: similarity, difference, what to do. Cite each source you rely on (up to two Knowledge base links).',
      };
    case 'coaching':
      return {
        maxDocs: 2,
        maxKbLinks: 2,
        singleSource: false,
        answerGuidance:
          'Use excerpts as evidence for practical advice. Lead with the direct answer, then next_steps grounded in TiB material. Include exactly 3 tasks in the JSON "tasks" array (physical, immediate, easiest first).',
      };
  }
}

export function resolveRagIntentParams(userQuery: string): RagIntentParams {
  const intent = classifyRagQueryIntent(userQuery);
  return { intent, ...ragParamsForIntent(intent) };
}
