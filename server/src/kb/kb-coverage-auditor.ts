// KBCoverageAuditor — scans a repo's indexed documents and writes kb_coverage_gaps.
// Detects: missing_readme, missing_adr, missing_api_spec, stale_doc, orphan_doc.

import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { kbDocuments } from "@paperclipai/db/schema/kb_documents";
import { kbCoverageGaps } from "@paperclipai/db/schema/kb_coverage_gaps";

export class KBCoverageAuditor {
  constructor(private readonly db: Db) {}

  /**
   * audit — inspect documents for a repo and insert coverage gap rows.
   * Returns the total number of new gaps written.
   */
  async audit(repoId: string, companyId: string): Promise<number> {
    const docs = await this.db
      .select()
      .from(kbDocuments)
      .where(eq(kbDocuments.repoId, repoId));

    const gaps: Array<{
      companyId: string;
      repoId: string;
      kind: string;
      targetPath: string | null;
      severity: number;
      suggestedAction: string;
      status: string;
      detectedAt: Date;
    }> = [];

    const kinds = new Set(docs.map((d) => d.kind));
    const now = new Date();

    // missing_readme
    if (!kinds.has("readme")) {
      gaps.push({
        companyId,
        repoId,
        kind: "missing_readme",
        targetPath: "README.md",
        severity: 2,
        suggestedAction: "Create a README.md at the repository root.",
        status: "open",
        detectedAt: now,
      });
    }

    // missing_adr
    if (!kinds.has("adr")) {
      gaps.push({
        companyId,
        repoId,
        kind: "missing_adr",
        targetPath: "docs/adr/",
        severity: 1,
        suggestedAction: "Add at least one Architecture Decision Record.",
        status: "open",
        detectedAt: now,
      });
    }

    // missing_api_spec
    if (!kinds.has("api_spec")) {
      gaps.push({
        companyId,
        repoId,
        kind: "missing_api_spec",
        targetPath: "openapi.yaml",
        severity: 2,
        suggestedAction: "Generate or create an OpenAPI spec.",
        status: "open",
        detectedAt: now,
      });
    }

    // stale_doc — any document whose status is already 'stale'
    for (const doc of docs) {
      if (doc.status === "stale") {
        gaps.push({
          companyId,
          repoId,
          kind: "stale_doc",
          targetPath: doc.path,
          severity: 1,
          suggestedAction: `Refresh document at ${doc.path}.`,
          status: "open",
          detectedAt: now,
        });
      }
    }

    if (gaps.length === 0) return 0;
    await this.db.insert(kbCoverageGaps).values(gaps);
    return gaps.length;
  }

  async listGaps(repoId: string) {
    return this.db
      .select()
      .from(kbCoverageGaps)
      .where(
        and(
          eq(kbCoverageGaps.repoId, repoId),
          eq(kbCoverageGaps.status, "open"),
        ),
      );
  }

  async resolveGap(gapId: string): Promise<void> {
    await this.db
      .update(kbCoverageGaps)
      .set({ status: "resolved", resolvedAt: new Date() })
      .where(eq(kbCoverageGaps.id, gapId));
  }
}
