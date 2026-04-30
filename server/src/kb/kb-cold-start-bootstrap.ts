// KBColdStartBootstrap — 5-stage pipeline per KB design §3.2.
// Stage 1: Magika inventory
// Stage 2: Triage (filter vendored/binary/generated)
// Stage 3: Fetch/upsert documents
// Stage 4: Chunk
// Stage 5: (Stub) Embed — embedding integration deferred; records 0 embeddings

import type { Db } from "@paperclipai/db";
import type { FileInput } from "./magika-inventory.js";
// kb_repositories imported via KBDocumentStore + services; no direct table access here
import { MagikaInventoryService, type MagikaClient } from "./magika-inventory.js";
import { KBDocumentStore } from "./kb-document-store.js";
import { KBCoverageAuditor } from "./kb-coverage-auditor.js";

export interface BootstrapSummary {
  filesIndexed: number;
  chunkCount: number;
  gaps: number;
}

const SOURCE_LABELS = new Set([
  "typescript",
  "javascript",
  "python",
  "go",
  "rust",
  "java",
  "csharp",
  "ruby",
  "php",
  "cpp",
  "c",
  "shell",
  "sql",
  "graphql",
  "protobuf",
]);

const DOC_LABELS = new Set(["markdown", "html"]);
const CONFIG_LABELS = new Set(["json", "yaml", "toml"]);

function inferKind(path: string, label: string): string {
  const lower = path.toLowerCase();
  if (/readme/i.test(lower)) return "readme";
  if (/adr[-_]/i.test(lower) || /\badr\b/i.test(lower)) return "adr";
  if (/openapi|swagger|api[-_]spec/i.test(lower)) return "api_spec";
  if (/design/i.test(lower)) return "design";
  if (DOC_LABELS.has(label) || CONFIG_LABELS.has(label)) return "readme";
  return "code";
}

export class KBColdStartBootstrap {
  private readonly magika: MagikaInventoryService;
  private readonly docStore: KBDocumentStore;
  private readonly auditor: KBCoverageAuditor;

  constructor(
    private readonly db: Db,
    magikaClient?: MagikaClient,
  ) {
    this.magika = new MagikaInventoryService(db, magikaClient);
    this.docStore = new KBDocumentStore(db);
    this.auditor = new KBCoverageAuditor(db);
  }

  async bootstrap(
    repoId: string,
    companyId: string,
    files: FileInput[],
  ): Promise<BootstrapSummary> {
    // Stage 1 — Magika inventory
    const inventory = await this.magika.inventory(repoId, files);

    // Stage 2 — Triage: keep only indexable files
    const indexable = inventory.filter(
      (r) =>
        !r.isVendored &&
        !r.isGenerated &&
        !r.isBinary &&
        (SOURCE_LABELS.has(r.label) ||
          DOC_LABELS.has(r.label) ||
          CONFIG_LABELS.has(r.label)),
    );

    // Stage 3 — Fetch/upsert documents
    let filesIndexed = 0;
    const docIds: string[] = [];
    for (const item of indexable) {
      const fileContent =
        files.find((f) => f.path === item.path)?.content ?? "";
      const kind = inferKind(item.path, item.label);
      const docId = await this.docStore.createDoc({
        companyId,
        repoId,
        kind,
        path: item.path,
        language: item.label,
        body: fileContent,
        lastModifiedAt: new Date(),
        status: "fresh",
      });
      docIds.push(docId);
      filesIndexed++;
    }

    // Stage 4 — Chunk
    let chunkCount = 0;
    for (let i = 0; i < indexable.length; i++) {
      const item = indexable[i]!;
      const docId = docIds[i]!;
      const fileContent =
        files.find((f) => f.path === item.path)?.content ?? "";
      if (fileContent.trim().length > 0) {
        chunkCount += await this.docStore.chunk(docId, fileContent, item.label);
      }
    }

    // Stage 5 — Embed (stub — real embedding pipeline deferred)
    // Embeddings are wired in by a separate embedding agent reading unembedded chunks.

    // Coverage audit
    const gaps = await this.auditor.audit(repoId, companyId);

    return { filesIndexed, chunkCount, gaps };
  }
}
