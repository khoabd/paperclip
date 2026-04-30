// PRGateKBUpdater — stub for Phase 11.
// Re-chunks changed files after a PR merges and bumps staleness scores.
// The actual PR webhook integration lands in Phase 12/13.

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { kbDocuments } from "@paperclipai/db/schema/kb_documents";
import { KBDocumentStore } from "./kb-document-store.js";
import { KBStalenessScorer } from "./kb-staleness-scorer.js";

export interface ChangedFile {
  path: string;
  content?: string | null;
}

export interface PRGateResult {
  rechunked: number;
  skipped: number;
}

export class PRGateKBUpdater {
  private readonly docStore: KBDocumentStore;
  private readonly staleness: KBStalenessScorer;

  constructor(private readonly db: Db) {
    this.docStore = new KBDocumentStore(db);
    this.staleness = new KBStalenessScorer(db);
  }

  /**
   * onPRMerged — re-chunks affected docs and resets their freshness.
   * Phase 12 will wire this into the actual PR webhook handler.
   */
  async onPRMerged(
    repoId: string,
    changedFiles: ChangedFile[],
  ): Promise<PRGateResult> {
    let rechunked = 0;
    let skipped = 0;

    for (const file of changedFiles) {
      const doc = await this.docStore.getByRepoAndPath(repoId, file.path);
      if (!doc) {
        skipped++;
        continue;
      }

      const content = file.content ?? doc.body ?? "";

      // Re-chunk with latest content
      if (content.trim().length > 0) {
        await this.docStore.chunk(doc.id, content, doc.language ?? "unknown");
      }

      // Mark fresh after re-chunking (PR brought it up to date)
      await this.db
        .update(kbDocuments)
        .set({ status: "fresh", updatedAt: new Date() })
        .where(eq(kbDocuments.id, doc.id));

      // Re-score staleness — recent PR = referenced recently
      await this.staleness.scoreDoc(doc.id, { referencedRecently: true });

      rechunked++;
    }

    return { rechunked, skipped };
  }
}
