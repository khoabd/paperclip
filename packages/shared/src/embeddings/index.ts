export type { EmbeddingProvider, EmbeddingProviderConfig } from "./types.js";
export { cosineSimilarity, topK, type ScoredVector } from "./cosine.js";
export {
  embed,
  embedBatch,
  resolveEmbeddingProvider,
  __resetEmbeddingProviderForTests,
  type ResolveProviderOptions,
} from "./embed.js";
export { MockEmbeddingProvider } from "./providers/mock.js";
export { OpenAiEmbeddingProvider } from "./providers/openai.js";
