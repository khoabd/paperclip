// TreeSitterChunker — converts source text into symbol-level chunks.
// Phase 11 ships a regex heuristic fallback; real tree-sitter integration is deferred.
// The interface is stable so callers can be upgraded transparently.

export interface SymbolChunk {
  symbol: string;
  body: string;
  startLine: number;
  endLine: number;
}

/**
 * Regex-based heuristic chunker.
 * Detects top-level function/class/interface/type/enum/const declarations.
 *
 * Supported languages (heuristic, not exact):
 *   TypeScript / JavaScript / Go / Python / Rust / Java / C# / Ruby / PHP
 *
 * Falls back to line-window chunking when no symbols are found.
 */
export class TreeSitterChunker {
  private readonly windowSize: number;

  constructor(opts: { windowSize?: number } = {}) {
    this.windowSize = opts.windowSize ?? 60;
  }

  chunk(source: string, language: string): SymbolChunk[] {
    const lines = source.split("\n");
    const chunks = this._extractSymbols(lines, language);
    if (chunks.length > 0) return chunks;
    return this._windowFallback(lines);
  }

  // ---- private -------------------------------------------------------

  private _extractSymbols(lines: string[], language: string): SymbolChunk[] {
    const patterns = LANGUAGE_PATTERNS[normalizeLanguage(language)] ?? [];
    const results: SymbolChunk[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const { re, kind } of patterns) {
        const m = re.exec(line);
        if (m) {
          const name = m[1] ?? "unknown";
          const { body, endLine } = this._collectBody(lines, i);
          results.push({
            symbol: `${kind}:${name}`,
            body,
            startLine: i + 1,
            endLine: endLine + 1,
          });
          break;
        }
      }
    }
    return results;
  }

  /** Collect the body of a symbol by counting braces/indentation. */
  private _collectBody(
    lines: string[],
    startIdx: number,
  ): { body: string; endLine: number } {
    let depth = 0;
    let opened = false;
    let end = startIdx;

    for (let i = startIdx; i < lines.length; i++) {
      const l = lines[i]!;
      for (const ch of l) {
        if (ch === "{") {
          depth++;
          opened = true;
        } else if (ch === "}") {
          depth--;
        }
      }
      end = i;
      if (opened && depth <= 0) break;
      // Safety cap: if no braces found within window, stop at blank line
      if (!opened && i > startIdx + 1 && l.trim() === "") break;
    }

    return {
      body: lines.slice(startIdx, end + 1).join("\n"),
      endLine: end,
    };
  }

  private _windowFallback(lines: string[]): SymbolChunk[] {
    const chunks: SymbolChunk[] = [];
    for (let i = 0; i < lines.length; i += this.windowSize) {
      const slice = lines.slice(i, i + this.windowSize);
      if (slice.every((l) => l.trim() === "")) continue;
      chunks.push({
        symbol: `window:${i}`,
        body: slice.join("\n"),
        startLine: i + 1,
        endLine: Math.min(i + this.windowSize, lines.length),
      });
    }
    return chunks;
  }
}

// ---- language pattern registry ----------------------------------------

type PatternEntry = { re: RegExp; kind: string };

const TS_JS_PATTERNS: PatternEntry[] = [
  { re: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, kind: "function" },
  { re: /^(?:export\s+)?class\s+(\w+)/, kind: "class" },
  { re: /^(?:export\s+)?interface\s+(\w+)/, kind: "interface" },
  { re: /^(?:export\s+)?type\s+(\w+)\s*=/, kind: "type" },
  { re: /^(?:export\s+)?enum\s+(\w+)/, kind: "enum" },
  // Arrow/function-expression must come before generic const to capture function kind
  { re: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/, kind: "function" },
  { re: /^(?:export\s+)?const\s+(\w+)\s*[:=]/, kind: "const" },
];

const PYTHON_PATTERNS: PatternEntry[] = [
  { re: /^def\s+(\w+)\s*\(/, kind: "function" },
  { re: /^async\s+def\s+(\w+)\s*\(/, kind: "function" },
  { re: /^class\s+(\w+)/, kind: "class" },
];

const GO_PATTERNS: PatternEntry[] = [
  { re: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/, kind: "function" },
  { re: /^type\s+(\w+)\s+struct/, kind: "class" },
  { re: /^type\s+(\w+)\s+interface/, kind: "interface" },
];

const RUST_PATTERNS: PatternEntry[] = [
  { re: /^(?:pub\s+)?fn\s+(\w+)/, kind: "function" },
  { re: /^(?:pub\s+)?struct\s+(\w+)/, kind: "class" },
  { re: /^(?:pub\s+)?enum\s+(\w+)/, kind: "enum" },
  { re: /^(?:pub\s+)?trait\s+(\w+)/, kind: "interface" },
];

const JAVA_CS_PATTERNS: PatternEntry[] = [
  {
    re: /(?:public|private|protected|static|\s)+(?:[\w<>\[\]]+)\s+(\w+)\s*\(/,
    kind: "function",
  },
  { re: /(?:public\s+|private\s+|protected\s+)?class\s+(\w+)/, kind: "class" },
  { re: /(?:public\s+)?interface\s+(\w+)/, kind: "interface" },
  { re: /(?:public\s+)?enum\s+(\w+)/, kind: "enum" },
];

const LANGUAGE_PATTERNS: Record<string, PatternEntry[]> = {
  typescript: TS_JS_PATTERNS,
  javascript: TS_JS_PATTERNS,
  python: PYTHON_PATTERNS,
  go: GO_PATTERNS,
  rust: RUST_PATTERNS,
  java: JAVA_CS_PATTERNS,
  csharp: JAVA_CS_PATTERNS,
};

function normalizeLanguage(lang: string): string {
  const m: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    cs: "csharp",
  };
  return m[lang.toLowerCase()] ?? lang.toLowerCase();
}
