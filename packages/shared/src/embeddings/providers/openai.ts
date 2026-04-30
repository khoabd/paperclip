import type { EmbeddingProvider, EmbeddingProviderConfig } from "../types.js";

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_ENDPOINT = "https://api.openai.com/v1/embeddings";
const MODEL_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

interface OpenAiEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(config: EmbeddingProviderConfig = {}) {
    this.model = config.model ?? DEFAULT_MODEL;
    this.dimensions = MODEL_DIMENSIONS[this.model] ?? 1536;
    const key = config.apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error("OpenAiEmbeddingProvider: OPENAI_API_KEY missing");
    }
    this.apiKey = key;
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  }

  async embed(text: string): Promise<number[]> {
    const [vec] = await this.embedBatch([text]);
    if (!vec) throw new Error("OpenAiEmbeddingProvider: empty response");
    return vec;
  }

  async embedBatch(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI embeddings failed (${response.status}): ${body}`);
    }
    const json = (await response.json()) as OpenAiEmbeddingResponse;
    return json.data.map((d) => d.embedding);
  }
}
