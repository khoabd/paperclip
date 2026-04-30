// Unit tests for TreeSitterChunker — regex fallback, no native deps.

import { describe, expect, it } from "vitest";
import { TreeSitterChunker } from "../tree-sitter-chunker.js";

describe("TreeSitterChunker", () => {
  const chunker = new TreeSitterChunker();

  describe("TypeScript / JavaScript heuristic", () => {
    it("extracts top-level exported function", () => {
      const src = `
export function greet(name: string): string {
  return \`Hello \${name}\`;
}
`.trim();
      const chunks = chunker.chunk(src, "typescript");
      expect(chunks.length).toBeGreaterThan(0);
      const fn = chunks.find((c) => c.symbol.startsWith("function:greet"));
      expect(fn).toBeDefined();
      expect(fn!.startLine).toBe(1);
    });

    it("extracts class declaration", () => {
      const src = `
export class UserService {
  constructor(private db: Db) {}
  async getUser(id: string) {
    return this.db.findById(id);
  }
}
`.trim();
      const chunks = chunker.chunk(src, "ts");
      const cls = chunks.find((c) => c.symbol.startsWith("class:UserService"));
      expect(cls).toBeDefined();
    });

    it("extracts interface", () => {
      const src = `
export interface UserProfile {
  id: string;
  name: string;
}
`.trim();
      const chunks = chunker.chunk(src, "typescript");
      const iface = chunks.find((c) =>
        c.symbol.startsWith("interface:UserProfile"),
      );
      expect(iface).toBeDefined();
    });

    it("extracts type alias", () => {
      const src = `export type Status = 'active' | 'inactive';`;
      const chunks = chunker.chunk(src, "typescript");
      const t = chunks.find((c) => c.symbol.startsWith("type:Status"));
      expect(t).toBeDefined();
    });

    it("extracts enum", () => {
      const src = `
export enum Color {
  Red,
  Green,
  Blue,
}
`.trim();
      const chunks = chunker.chunk(src, "typescript");
      const e = chunks.find((c) => c.symbol.startsWith("enum:Color"));
      expect(e).toBeDefined();
    });

    it("extracts const arrow function", () => {
      const src = `export const handler = async (req, res) => { res.json({}); };`;
      const chunks = chunker.chunk(src, "javascript");
      const fn = chunks.find((c) => c.symbol.startsWith("function:handler"));
      expect(fn).toBeDefined();
    });

    it("multiple top-level symbols produce multiple chunks", () => {
      const src = `
export function a() { return 1; }
export function b() { return 2; }
export class C {}
`.trim();
      const chunks = chunker.chunk(src, "typescript");
      expect(chunks.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Python heuristic", () => {
    it("extracts def function", () => {
      const src = `
def compute_score(value: float) -> float:
    return value * 2.0
`.trim();
      const chunks = chunker.chunk(src, "python");
      const fn = chunks.find((c) =>
        c.symbol.startsWith("function:compute_score"),
      );
      expect(fn).toBeDefined();
    });

    it("extracts async def", () => {
      const src = `
async def fetch_data(url: str):
    pass
`.trim();
      const chunks = chunker.chunk(src, "python");
      const fn = chunks.find((c) => c.symbol.startsWith("function:fetch_data"));
      expect(fn).toBeDefined();
    });

    it("extracts class", () => {
      const src = `
class DataProcessor:
    def __init__(self):
        pass
`.trim();
      const chunks = chunker.chunk(src, "python");
      const cls = chunks.find((c) =>
        c.symbol.startsWith("class:DataProcessor"),
      );
      expect(cls).toBeDefined();
    });
  });

  describe("Go heuristic", () => {
    it("extracts func", () => {
      const src = `
func ProcessItem(item Item) error {
    return nil
}
`.trim();
      const chunks = chunker.chunk(src, "go");
      const fn = chunks.find((c) =>
        c.symbol.startsWith("function:ProcessItem"),
      );
      expect(fn).toBeDefined();
    });

    it("extracts struct as class", () => {
      const src = `
type Config struct {
    Host string
    Port int
}
`.trim();
      const chunks = chunker.chunk(src, "go");
      const s = chunks.find((c) => c.symbol.startsWith("class:Config"));
      expect(s).toBeDefined();
    });
  });

  describe("Window fallback", () => {
    it("falls back to line windows when no symbols found", () => {
      const lines = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`);
      const src = lines.join("\n");
      const chunks = chunker.chunk(src, "unknown");
      // 120 lines / 60 = 2 windows
      expect(chunks.length).toBe(2);
      expect(chunks[0]!.symbol).toBe("window:0");
      expect(chunks[1]!.symbol).toBe("window:60");
    });

    it("skips fully blank windows", () => {
      const src = "\n\n\n\n";
      const chunks = chunker.chunk(src, "unknown");
      expect(chunks.length).toBe(0);
    });

    it("uses custom window size", () => {
      const smallChunker = new TreeSitterChunker({ windowSize: 10 });
      const lines = Array.from({ length: 30 }, (_, i) => `x${i}`);
      const chunks = smallChunker.chunk(lines.join("\n"), "unknown");
      expect(chunks.length).toBe(3);
    });
  });

  describe("body and line numbers", () => {
    it("startLine is 1-based", () => {
      const src = `export function first() { return 1; }`;
      const chunks = chunker.chunk(src, "typescript");
      expect(chunks[0]!.startLine).toBe(1);
    });

    it("body contains the source text", () => {
      const src = `
export function doWork() {
  const x = 1;
  return x;
}
`.trim();
      const chunks = chunker.chunk(src, "typescript");
      expect(chunks[0]!.body).toContain("doWork");
      expect(chunks[0]!.body).toContain("return x");
    });
  });
});
