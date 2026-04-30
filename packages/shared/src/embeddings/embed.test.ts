import { afterEach, describe, expect, it } from "vitest";
import {
  embed,
  embedBatch,
  resolveEmbeddingProvider,
  __resetEmbeddingProviderForTests,
} from "./embed.js";
import { MockEmbeddingProvider } from "./providers/mock.js";

afterEach(() => {
  __resetEmbeddingProviderForTests();
  delete process.env.EMBED_PROVIDER;
});

describe("embed (mock provider)", () => {
  it("returns 1536-dim vector by default", async () => {
    const vec = await embed("hello world");
    expect(vec).toHaveLength(1536);
    expect(vec.every((n) => typeof n === "number" && Number.isFinite(n))).toBe(true);
  });

  it("is deterministic for the same input", async () => {
    const a = await embed("paperclip");
    const b = await embed("paperclip");
    expect(a).toEqual(b);
  });

  it("differs for different inputs", async () => {
    const a = await embed("paperclip");
    const b = await embed("clippy");
    expect(a).not.toEqual(b);
  });

  it("normalises output (unit vector)", async () => {
    const vec = await embed("normalise me");
    let norm = 0;
    for (const v of vec) norm += v * v;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  });

  it("embedBatch returns same length as input", async () => {
    const vecs = await embedBatch(["a", "b", "c"]);
    expect(vecs).toHaveLength(3);
    for (const v of vecs) expect(v).toHaveLength(1536);
  });
});

describe("resolveEmbeddingProvider", () => {
  it("defaults to mock", () => {
    const p = resolveEmbeddingProvider();
    expect(p).toBeInstanceOf(MockEmbeddingProvider);
    expect(p.dimensions).toBe(1536);
  });

  it("respects EMBED_PROVIDER=mock", () => {
    process.env.EMBED_PROVIDER = "mock";
    const p = resolveEmbeddingProvider();
    expect(p).toBeInstanceOf(MockEmbeddingProvider);
  });

  it("supports custom dimensions on mock", async () => {
    const p = new MockEmbeddingProvider({ dimensions: 64 });
    const vec = await p.embed("dim-test");
    expect(vec).toHaveLength(64);
  });
});
