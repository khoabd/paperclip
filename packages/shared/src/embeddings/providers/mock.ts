import type { EmbeddingProvider } from "../types.js";

function fnv1a(input: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function deterministicVector(text: string, dimensions: number): number[] {
  const out = new Array<number>(dimensions);
  let seed = fnv1a(text);
  for (let i = 0; i < dimensions; i += 1) {
    seed = Math.imul(seed ^ (seed >>> 16), 2246822507) >>> 0;
    seed = Math.imul(seed ^ (seed >>> 13), 3266489909) >>> 0;
    seed = (seed ^ (seed >>> 16)) >>> 0;
    out[i] = (seed / 0xffffffff) * 2 - 1;
  }
  let norm = 0;
  for (const v of out) norm += v * v;
  const scale = norm > 0 ? 1 / Math.sqrt(norm) : 0;
  for (let i = 0; i < dimensions; i += 1) out[i] = (out[i] ?? 0) * scale;
  return out;
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;

  constructor(opts: { model?: string; dimensions?: number } = {}) {
    this.model = opts.model ?? "mock-embedding";
    this.dimensions = opts.dimensions ?? 1536;
  }

  async embed(text: string): Promise<number[]> {
    return deterministicVector(text, this.dimensions);
  }

  async embedBatch(texts: readonly string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
