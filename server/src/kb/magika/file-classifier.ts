// Pure-TS file type classifier per ADR-0004 §file-classify.
// Stand-in for the Magika Python sidecar: deterministic content sniffing + extension
// fallback so the rest of the platform (greenfield intake, KB ingest) does not have
// to wait for Python runtime in CI. The real Magika sidecar is a drop-in replacement
// behind the same FileClassifier interface — production swaps in when Python is
// available; tests and local dev keep working with this implementation.

export type FileKind =
  | "typescript"
  | "javascript"
  | "python"
  | "shell"
  | "markdown"
  | "json"
  | "yaml"
  | "html"
  | "css"
  | "image_png"
  | "image_jpeg"
  | "pdf"
  | "executable_elf"
  | "executable_pe"
  | "binary"
  | "text"
  | "unknown";

export type ClassifyResult = {
  filename: string;
  declaredExtension: string | null;
  kind: FileKind;
  confidence: number;
  bytes: number;
  /** True when the declared extension does not match the sniffed content kind. */
  supplyChainAnomaly: boolean;
  source: "magic_bytes" | "shebang" | "syntax_heuristic" | "extension" | "fallback";
};

const MAGIC_BYTES: Array<{ bytes: number[]; kind: FileKind }> = [
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], kind: "image_png" },
  { bytes: [0xff, 0xd8, 0xff], kind: "image_jpeg" },
  { bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], kind: "pdf" }, // %PDF-
  { bytes: [0x7f, 0x45, 0x4c, 0x46], kind: "executable_elf" }, // ELF
  { bytes: [0x4d, 0x5a], kind: "executable_pe" }, // MZ (Windows PE)
];

const EXT_TO_KIND: Record<string, FileKind> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  md: "markdown",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  html: "html",
  htm: "html",
  css: "css",
  png: "image_png",
  jpg: "image_jpeg",
  jpeg: "image_jpeg",
  pdf: "pdf",
  exe: "executable_pe",
  dll: "executable_pe",
  so: "executable_elf",
  elf: "executable_elf",
};

function getExtension(filename: string): string | null {
  const idx = filename.lastIndexOf(".");
  if (idx < 0 || idx === filename.length - 1) return null;
  return filename.slice(idx + 1).toLowerCase();
}

function startsWithBytes(buf: Uint8Array, magic: number[]): boolean {
  if (buf.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buf[i] !== magic[i]) return false;
  }
  return true;
}

function sniffShebang(buf: Uint8Array): FileKind | null {
  if (buf.length < 2 || buf[0] !== 0x23 || buf[1] !== 0x21) return null; // "#!"
  const firstLine = new TextDecoder("utf-8", { fatal: false })
    .decode(buf.slice(0, Math.min(buf.length, 256)))
    .split("\n", 1)[0]
    .toLowerCase();
  // Match interpreter names that follow a space (env-style) or a slash (direct path).
  if (/(^|[\/\s])python(3?)?($|\s)/.test(firstLine)) return "python";
  if (/(^|[\/\s])node($|\s)/.test(firstLine)) return "javascript";
  if (/(^|[\/\s])(bash|zsh|sh)($|\s)/.test(firstLine)) return "shell";
  return "shell"; // generic shebang → shell
}

function sniffTextSyntax(text: string): FileKind | null {
  const head = text.slice(0, 4096);

  // JSON: starts with { or [ then valid JSON (cheap heuristic).
  const trimmed = head.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // fall through
    }
  }

  if (/^---\s*\n/.test(head)) return "yaml";
  if (/^<!doctype html|^<html\b/i.test(head)) return "html";
  if (/^#\s|\n#\s|\n##\s/.test(head)) return "markdown";

  // TS/JS shape detection: common keywords plus types.
  if (/\bimport\s+.*from\s+['"]/.test(head) || /\bexport\s+(default\s+|const\s+|function\s+|class\s+)/.test(head)) {
    if (/:\s*(string|number|boolean|void|unknown|any)\b/.test(head) || /\binterface\s+\w+/.test(head)) {
      return "typescript";
    }
    return "javascript";
  }

  if (/\bdef\s+\w+\s*\(/.test(head) || /\bimport\s+\w+(\s+as\s+\w+)?\s*\n/.test(head)) {
    return "python";
  }

  return null;
}

export interface FileClassifier {
  classify(input: { filename: string; content: Uint8Array }): Promise<ClassifyResult>;
}

export class HeuristicFileClassifier implements FileClassifier {
  async classify(input: { filename: string; content: Uint8Array }): Promise<ClassifyResult> {
    const { filename, content } = input;
    const ext = getExtension(filename);
    const declaredKind = ext ? EXT_TO_KIND[ext] ?? null : null;

    // 1. Magic bytes (most authoritative).
    for (const m of MAGIC_BYTES) {
      if (startsWithBytes(content, m.bytes)) {
        return {
          filename,
          declaredExtension: ext,
          kind: m.kind,
          confidence: 0.99,
          bytes: content.length,
          supplyChainAnomaly: declaredKind !== null && declaredKind !== m.kind,
          source: "magic_bytes",
        };
      }
    }

    // 2. Shebang.
    const shebangKind = sniffShebang(content);
    if (shebangKind) {
      return {
        filename,
        declaredExtension: ext,
        kind: shebangKind,
        confidence: 0.95,
        bytes: content.length,
        supplyChainAnomaly: declaredKind !== null && declaredKind !== shebangKind,
        source: "shebang",
      };
    }

    // 3. Text syntax heuristics.
    const text = new TextDecoder("utf-8", { fatal: false }).decode(content);
    const syntaxKind = sniffTextSyntax(text);
    if (syntaxKind) {
      return {
        filename,
        declaredExtension: ext,
        kind: syntaxKind,
        confidence: 0.85,
        bytes: content.length,
        supplyChainAnomaly: declaredKind !== null && declaredKind !== syntaxKind,
        source: "syntax_heuristic",
      };
    }

    // 4. Fall back to declared extension.
    if (declaredKind) {
      return {
        filename,
        declaredExtension: ext,
        kind: declaredKind,
        confidence: 0.6,
        bytes: content.length,
        supplyChainAnomaly: false,
        source: "extension",
      };
    }

    // 5. Last resort: text vs binary.
    const isText = text.length > 0 && !/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 1024));
    return {
      filename,
      declaredExtension: ext,
      kind: isText ? "text" : "binary",
      confidence: 0.4,
      bytes: content.length,
      supplyChainAnomaly: false,
      source: "fallback",
    };
  }
}

export type BatchClassifyResult = {
  results: ClassifyResult[];
  durationMs: number;
  throughputPerSecond: number;
  anomalies: ClassifyResult[];
};

export async function classifyBatch(
  classifier: FileClassifier,
  files: ReadonlyArray<{ filename: string; content: Uint8Array }>,
): Promise<BatchClassifyResult> {
  const start = Date.now();
  const results: ClassifyResult[] = [];
  for (const f of files) {
    results.push(await classifier.classify(f));
  }
  const durationMs = Math.max(1, Date.now() - start);
  return {
    results,
    durationMs,
    throughputPerSecond: (files.length / durationMs) * 1000,
    anomalies: results.filter((r) => r.supplyChainAnomaly),
  };
}
