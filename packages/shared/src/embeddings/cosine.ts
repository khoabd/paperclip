export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: dimension mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface ScoredVector<T> {
  item: T;
  score: number;
}

export function topK<T>(
  query: readonly number[],
  items: ReadonlyArray<{ item: T; embedding: readonly number[] }>,
  k: number,
): ScoredVector<T>[] {
  const scored: ScoredVector<T>[] = items.map(({ item, embedding }) => ({
    item,
    score: cosineSimilarity(query, embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
