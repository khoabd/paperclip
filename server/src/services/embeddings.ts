const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const EMBED_MODEL = process.env.EMBED_MODEL ?? "all-minilm";

export async function embedText(text: string): Promise<number[]> {
  // Use /api/embed (newer endpoint) with truncate:true to handle long inputs gracefully
  const response = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: text, truncate: true }),
  });
  if (!response.ok) {
    throw new Error(`Ollama embed request failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json() as { embeddings: number[][] };
  return data.embeddings[0] ?? [];
}

// all-minilm supports max 256 tokens (~150 words) — keep chunks small
export function chunkText(text: string, maxWords = 120, overlap = 20): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + maxWords, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end >= words.length) break;
    start = end - overlap;
    if (start < 0) start = 0;
  }

  return chunks;
}

export async function embedDocument(
  _docId: string,
  text: string,
): Promise<{ chunkIndex: number; chunkText: string; embedding: number[] }[]> {
  const chunks = chunkText(text);
  const results: { chunkIndex: number; chunkText: string; embedding: number[] }[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;
    const embedding = await embedText(chunk);
    results.push({ chunkIndex: i, chunkText: chunk, embedding });
  }

  return results;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}
