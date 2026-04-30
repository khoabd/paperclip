// MagikaInventory — wraps a Magika client (mock for tests, real sidecar in prod per ADR-0004).
// Writes rows to magika_inventory from a batch of file path+content pairs.

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { magikaInventory } from "@paperclipai/db/schema/magika_inventory";

export interface FileInput {
  path: string;
  content: string;
}

export interface MagikaResult {
  path: string;
  label: string;
  confidence: number;
  isVendored: boolean;
  isGenerated: boolean;
  isBinary: boolean;
}

/** Minimal interface that a real Magika sidecar (ADR-0004) must satisfy. */
export interface MagikaClient {
  classifyFiles(files: FileInput[]): Promise<MagikaResult[]>;
}

/** Heuristic mock client — used in tests and when sidecar is unavailable. */
export class MockMagikaClient implements MagikaClient {
  async classifyFiles(files: FileInput[]): Promise<MagikaResult[]> {
    return files.map((f) => {
      const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
      const label = extToLabel(ext);
      const isVendored =
        /node_modules|vendor\/|third_party|\.venv/.test(f.path);
      const isGenerated =
        /DO NOT EDIT|@generated/.test(f.content) ||
        /\.pb\.ts$|\.pb\.js$|codegen/.test(f.path);
      const isBinary = label === "binary" || label === "elf" || label === "pe";
      return {
        path: f.path,
        label,
        confidence: 0.98,
        isVendored,
        isGenerated,
        isBinary,
      };
    });
  }
}

function extToLabel(ext: string): string {
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    rb: "ruby",
    php: "php",
    cs: "csharp",
    cpp: "cpp",
    c: "c",
    h: "c",
    md: "markdown",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    html: "html",
    css: "css",
    proto: "protobuf",
    graphql: "graphql",
    gql: "graphql",
  };
  return map[ext] ?? "unknown";
}

export class MagikaInventoryService {
  constructor(
    private readonly db: Db,
    private readonly client: MagikaClient = new MockMagikaClient(),
  ) {}

  /**
   * Classify all provided files and persist results to magika_inventory.
   * Uses ON CONFLICT DO UPDATE so re-running is safe (upsert by repo_id + file_path).
   */
  async inventory(
    repoId: string,
    files: FileInput[],
  ): Promise<MagikaResult[]> {
    if (files.length === 0) return [];
    const results = await this.client.classifyFiles(files);
    const rows = results.map((r) => ({
      repoId,
      filePath: r.path,
      magikaLabel: r.label,
      confidence: r.confidence.toFixed(4),
      isVendored: r.isVendored,
      isGenerated: r.isGenerated,
      isBinary: r.isBinary,
      capturedAt: new Date(),
    }));
    // Upsert — re-running the same repo scan is idempotent.
    await this.db
      .insert(magikaInventory)
      .values(rows)
      .onConflictDoUpdate({
        target: [magikaInventory.repoId, magikaInventory.filePath],
        set: {
          magikaLabel: magikaInventory.magikaLabel,
          confidence: magikaInventory.confidence,
          isVendored: magikaInventory.isVendored,
          isGenerated: magikaInventory.isGenerated,
          isBinary: magikaInventory.isBinary,
          capturedAt: magikaInventory.capturedAt,
        },
      });
    return results;
  }

  async listForRepo(repoId: string): Promise<(typeof magikaInventory.$inferSelect)[]> {
    return this.db
      .select()
      .from(magikaInventory)
      .where(eq(magikaInventory.repoId, repoId));
  }
}
