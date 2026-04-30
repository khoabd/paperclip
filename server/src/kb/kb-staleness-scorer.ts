// KBStalenessScorer — computes a 0..1 staleness score for a document and persists
// a kb_doc_staleness row (upsert by document_id).
//
// Score formula:
//   age_factor    = clamp(daysSinceModified / AGE_CEILING_DAYS, 0, 1)
//   recent_factor = referenced_recently ? 0 : 0.3   (heuristic bump if not referenced)
//   score         = clamp(age_factor * 0.7 + recent_factor, 0, 1)

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { kbDocuments } from "@paperclipai/db/schema/kb_documents";
import { kbDocStaleness } from "@paperclipai/db/schema/kb_doc_staleness";

const AGE_CEILING_DAYS = 180; // 6 months → score of 1.0 on age axis

export interface StalenessResult {
  documentId: string;
  score: number;
  reason: string;
}

export class KBStalenessScorer {
  constructor(private readonly db: Db) {}

  async scoreDoc(
    documentId: string,
    opts: { referencedRecently?: boolean } = {},
  ): Promise<StalenessResult> {
    const doc = await this._getDoc(documentId);
    if (!doc) {
      throw new Error(`Document not found: ${documentId}`);
    }

    const daysSinceModified = doc.lastModifiedAt
      ? (Date.now() - new Date(doc.lastModifiedAt).getTime()) /
        (1000 * 60 * 60 * 24)
      : AGE_CEILING_DAYS;

    const ageFactor = Math.min(daysSinceModified / AGE_CEILING_DAYS, 1);
    const recentFactor = opts.referencedRecently === true ? 0 : 0.3;
    const raw = ageFactor * 0.7 + recentFactor;
    const score = Math.min(Math.max(raw, 0), 1);

    const reason = buildReason(daysSinceModified, opts.referencedRecently ?? false);

    // Upsert into kb_doc_staleness
    await this.db
      .insert(kbDocStaleness)
      .values({
        documentId,
        score: score.toFixed(4),
        reason,
        lastCheckAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [kbDocStaleness.documentId],
        set: {
          score: score.toFixed(4),
          reason,
          lastCheckAt: new Date(),
        },
      });

    return { documentId, score, reason };
  }

  async getStalnessRow(documentId: string) {
    return (
      await this.db
        .select()
        .from(kbDocStaleness)
        .where(eq(kbDocStaleness.documentId, documentId))
        .limit(1)
    )[0];
  }

  private async _getDoc(documentId: string) {
    return (
      await this.db
        .select()
        .from(kbDocuments)
        .where(eq(kbDocuments.id, documentId))
        .limit(1)
    )[0];
  }
}

function buildReason(daysSince: number, referencedRecently: boolean): string {
  const parts: string[] = [];
  if (daysSince >= AGE_CEILING_DAYS) {
    parts.push(`not modified in over ${AGE_CEILING_DAYS} days`);
  } else if (daysSince > 30) {
    parts.push(`not modified in ${Math.round(daysSince)} days`);
  } else {
    parts.push(`modified ${Math.round(daysSince)} days ago`);
  }
  if (!referencedRecently) parts.push("not recently referenced");
  return parts.join("; ");
}
