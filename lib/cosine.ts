export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector length mismatch: ${a.length} vs ${b.length}`
    );
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function topKSimilar<T>(
  query: number[],
  items: Array<{ embedding: number[]; payload: T }>,
  k: number
): Array<{ score: number; payload: T }> {
  const scored = items.map((it) => ({
    score: cosineSimilarity(query, it.embedding),
    payload: it.payload,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
