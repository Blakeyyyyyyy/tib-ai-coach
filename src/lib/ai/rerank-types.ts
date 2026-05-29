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
  /** Indices to exclude (off-topic or low relevance) */
  drop: number[];
};
