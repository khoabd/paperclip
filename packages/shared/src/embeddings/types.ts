export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: readonly string[]): Promise<number[][]>;
}

export interface EmbeddingProviderConfig {
  readonly model?: string;
  readonly apiKey?: string;
  readonly endpoint?: string;
}
