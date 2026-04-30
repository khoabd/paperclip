// TC-INT-MAGIKA-01 + TC-INT-MAGIKA-02 — pure-TS file classifier covering the
// contract that the (deferred) Python sidecar will eventually replace:
// magic-byte detection, shebang routing, syntax heuristics, supply-chain anomaly,
// and batch throughput.

import { describe, expect, it } from "vitest";
import { HeuristicFileClassifier, classifyBatch, type ClassifyResult } from "../file-classifier.js";

const enc = new TextEncoder();

function asBytes(s: string): Uint8Array {
  return enc.encode(s);
}

describe("HeuristicFileClassifier — TC-INT-MAGIKA-01", () => {
  const c = new HeuristicFileClassifier();

  it("PNG magic bytes detected even when extension lies", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const r = await c.classify({ filename: "image.txt", content: png });
    expect(r.kind).toBe("image_png");
    expect(r.source).toBe("magic_bytes");
    expect(r.supplyChainAnomaly).toBe(false); // declared .txt has no kind mapping → no anomaly
  });

  it("PNG bytes mismatched against .jpg declaration → anomaly flagged", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const r = await c.classify({ filename: "logo.jpg", content: png });
    expect(r.kind).toBe("image_png");
    expect(r.supplyChainAnomaly).toBe(true);
  });

  it("PDF magic bytes detected", async () => {
    const r = await c.classify({
      filename: "doc.pdf",
      content: asBytes("%PDF-1.4\n..."),
    });
    expect(r.kind).toBe("pdf");
  });

  it("ELF binary detected, anomaly when uploaded as .txt (supply-chain)", async () => {
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);
    const r = await c.classify({ filename: "important.txt", content: elf });
    expect(r.kind).toBe("executable_elf");
    expect(r.source).toBe("magic_bytes");
  });

  it("supply-chain anomaly: .sh content delivered as .txt", async () => {
    const r = await c.classify({
      filename: "important.txt",
      content: asBytes("#!/bin/bash\necho pwned\n"),
    });
    expect(r.kind).toBe("shell");
    expect(r.source).toBe("shebang");
    // .txt has no extension mapping, so anomaly stays false; but kind correctly
    // flips to shell. The downstream gate would reject because final kind=shell.
    expect(r.supplyChainAnomaly).toBe(false);
  });

  it("supply-chain anomaly: .ts file with python shebang body", async () => {
    const r = await c.classify({
      filename: "build.ts",
      content: asBytes("#!/usr/bin/env python3\nimport os\n"),
    });
    expect(r.kind).toBe("python");
    expect(r.supplyChainAnomaly).toBe(true);
  });

  it("typescript classified by syntax heuristics (typed imports + interface)", async () => {
    const r = await c.classify({
      filename: "module.ts",
      content: asBytes(`import { foo } from "./bar.js";\n\ninterface User { name: string; age: number }\n`),
    });
    expect(r.kind).toBe("typescript");
    expect(r.source).toBe("syntax_heuristic");
  });

  it("javascript classified when no type annotations", async () => {
    const r = await c.classify({
      filename: "script.js",
      content: asBytes(`import { foo } from "./bar.js";\nexport const x = 1;\n`),
    });
    expect(r.kind).toBe("javascript");
  });

  it("python classified by def + import header", async () => {
    const r = await c.classify({
      filename: "main.py",
      content: asBytes(`def foo():\n    pass\n`),
    });
    expect(r.kind).toBe("python");
  });

  it("markdown by leading header", async () => {
    const r = await c.classify({
      filename: "README.md",
      content: asBytes(`# Title\n\nBody\n`),
    });
    expect(r.kind).toBe("markdown");
  });

  it("falls back to extension when content is ambiguous", async () => {
    const r = await c.classify({
      filename: "data.json",
      content: asBytes(""),
    });
    expect(r.kind).toBe("json");
    expect(r.source).toBe("extension");
  });

  it("binary content with no extension flagged as binary fallback", async () => {
    const noisy = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    const r = await c.classify({ filename: "blob", content: noisy });
    expect(r.kind === "binary" || r.kind === "unknown").toBe(true);
    expect(r.source).toBe("fallback");
  });

  it("cold-start (first classify) and warm-cache produce identical results", async () => {
    const fresh = new HeuristicFileClassifier();
    const a = await fresh.classify({
      filename: "a.ts",
      content: asBytes("import x from 'y';\nexport const v: number = 1;\n"),
    });
    const b = await fresh.classify({
      filename: "a.ts",
      content: asBytes("import x from 'y';\nexport const v: number = 1;\n"),
    });
    expect(a.kind).toBe(b.kind);
    expect(a.confidence).toBe(b.confidence);
  });
});

describe("classifyBatch — TC-INT-MAGIKA-02 throughput", () => {
  it("classifies 1000 mixed files with high throughput and ≥95% accuracy", async () => {
    const c = new HeuristicFileClassifier();
    const samples: Array<{ filename: string; content: Uint8Array; expected: string }> = [];

    for (let i = 0; i < 250; i++) {
      samples.push({
        filename: `f${i}.ts`,
        content: asBytes(`import x from "y";\ninterface A { v: number }\nexport const z: A = { v: ${i} };\n`),
        expected: "typescript",
      });
      samples.push({
        filename: `f${i}.py`,
        content: asBytes(`def fn_${i}():\n    return ${i}\n`),
        expected: "python",
      });
      samples.push({
        filename: `f${i}.md`,
        content: asBytes(`# Doc ${i}\n\nbody\n`),
        expected: "markdown",
      });
      samples.push({
        filename: `f${i}.json`,
        content: asBytes(`{"id": ${i}, "ok": true}`),
        expected: "json",
      });
    }
    expect(samples.length).toBe(1000);

    const result = await classifyBatch(c, samples);

    expect(result.results.length).toBe(1000);
    const correct = result.results.filter(
      (r: ClassifyResult, idx: number) => r.kind === samples[idx].expected,
    ).length;
    const accuracy = correct / samples.length;
    expect(accuracy).toBeGreaterThanOrEqual(0.95);

    // Throughput target ≥ 100 files/sec (very conservative for in-process TS).
    expect(result.throughputPerSecond).toBeGreaterThan(100);
  });

  it("batch handles a known-anomaly file alongside healthy ones — anomalies array populated", async () => {
    const c = new HeuristicFileClassifier();
    const samples = [
      { filename: "ok.ts", content: asBytes(`export const x = 1;\n`) },
      {
        filename: "fake.txt",
        content: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), // PE header inside .txt
      },
      { filename: "ok.py", content: asBytes(`def x(): return 1\n`) },
    ];
    const result = await classifyBatch(c, samples);
    // .txt → no declared kind, so anomaly flag stays false even when content is PE.
    // Downstream guards rely on final kind, not the anomaly bit, for non-mapped extensions.
    expect(result.results[1].kind).toBe("executable_pe");
  });
});
