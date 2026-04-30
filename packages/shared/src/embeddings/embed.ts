import type { EmbeddingProvider } from "./types.js";
import { MockEmbeddingProvider } from "./providers/mock.js";
import { OpenAiEmbeddingProvider } from "./providers/openai.js";

export interface ResolveProviderOptions {
  provider?: "mock" | "openai";
  model?: string;
  apiKey?: string;
  endpoint?: string;
}

export function resolveEmbeddingProvider(opts: ResolveProviderOptions = {}): EmbeddingProvider {
  const kind = opts.provider ?? (process.env.EMBED_PROVIDER as "mock" | "openai" | undefined) ?? "mock";
  switch (kind) {
    case "openai":
      return new OpenAiEmbeddingProvider({
        model: opts.model,
        apiKey: opts.apiKey,
        endpoint: opts.endpoint,
      });
    case "mock":
    default:
      return new MockEmbeddingProvider({ model: opts.model });
  }
}

let cached: EmbeddingProvider | null = null;
function getDefaultProvider(): EmbeddingProvider {
  if (!cached) cached = resolveEmbeddingProvider();
  return cached;
}

export async function embed(text: string): Promise<number[]> {
  return getDefaultProvider().embed(text);
}

export async function embedBatch(texts: readonly string[]): Promise<number[][]> {
  return getDefaultProvider().embedBatch(texts);
}

export function __resetEmbeddingProviderForTests(): void {
  cached = null;
}
