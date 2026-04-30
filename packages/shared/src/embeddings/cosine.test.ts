import { describe, expect, it } from "vitest";
import { cosineSimilarity, topK } from "./cosine.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 6);
  });

  it("returns 0 for zero vector", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("rejects mismatched dimensions", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/dimension mismatch/);
  });
});

describe("topK", () => {
  it("ranks vectors by descending similarity", () => {
    const query = [1, 0, 0];
    const items = [
      { item: "a", embedding: [0, 1, 0] },
      { item: "b", embedding: [1, 0, 0] },
      { item: "c", embedding: [0.7, 0.7, 0] },
    ];
    const ranked = topK(query, items, 3);
    expect(ranked.map((r) => r.item)).toEqual(["b", "c", "a"]);
    expect(ranked[0]?.score).toBeCloseTo(1, 6);
  });

  it("respects k boundary", () => {
    const query = [1, 0];
    const items = [
      { item: 1, embedding: [1, 0] },
      { item: 2, embedding: [0.5, 0.5] },
      { item: 3, embedding: [0, 1] },
    ];
    expect(topK(query, items, 2)).toHaveLength(2);
  });
});
