// FeedbackClusterer: runs DBSCAN clustering against intake_items of type feedback_*
// and populates feedback_clusters.
// Closes Phase-5 deferred scope.
// Per Phase-10 spec §10.2.

import { and, eq, inArray, like, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { intakeItems, feedbackClusters, entityEmbeddings } from "@paperclipai/db";
// feedbackClusters and intakeItems are already in @paperclipai/db (Phase 5)
import { DBSCANClusterer, computeCentroid } from "./dbscan-clusterer.js";

export interface FeedbackClusterRunResult {
  clustersUpserted: number;
  itemsProcessed: number;
}

export class FeedbackClusterer {
  private readonly dbscan = new DBSCANClusterer(0.25, 3);

  constructor(private readonly db: Db) {}

  async clusterFeedback(
    companyId: string,
    days = 30,
  ): Promise<FeedbackClusterRunResult> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceIso = since.toISOString();

    // Pull feedback_* intake items — use ISO string for date comparison
    const items = await this.db
      .select()
      .from(intakeItems)
      .where(
        and(
          eq(intakeItems.companyId, companyId),
          like(intakeItems.type, "feedback%"),
          sql`${intakeItems.createdAt} >= ${sinceIso}::timestamptz`,
        ),
      );

    if (items.length === 0) {
      return { clustersUpserted: 0, itemsProcessed: 0 };
    }

    const itemIds = items.map((i) => i.id);

    // Look for entity_embeddings for these intake items
    const embRows = await this.db
      .select()
      .from(entityEmbeddings)
      .where(
        and(
          eq(entityEmbeddings.companyId, companyId),
          eq(entityEmbeddings.entityType, "intake_item"),
          inArray(entityEmbeddings.entityId, itemIds),
        ),
      );

    if (embRows.length === 0) {
      return { clustersUpserted: 0, itemsProcessed: 0 };
    }

    const embeddingMap = new Map(embRows.map((r) => [r.entityId, r.embedding as number[]]));

    const points = items
      .filter((i) => embeddingMap.has(i.id))
      .map((i) => ({
        id: i.id,
        embedding: embeddingMap.get(i.id)!,
      }));

    if (points.length === 0) {
      return { clustersUpserted: 0, itemsProcessed: 0 };
    }

    const result = this.dbscan.cluster(points);

    const clusterGroups = new Map<number, typeof points>();
    for (const pt of points) {
      const cIdx = result.assignments.get(pt.id) ?? -1;
      if (cIdx === -1) continue;
      if (!clusterGroups.has(cIdx)) clusterGroups.set(cIdx, []);
      clusterGroups.get(cIdx)!.push(pt);
    }

    let clustersUpserted = 0;

    for (const [, members] of clusterGroups) {
      const memberIds = members.map((m) => m.id);
      const size = members.length;
      // Compute centroid for future use
      computeCentroid(members.map((m) => m.embedding));

      // Check if an existing cluster overlaps significantly
      const existing = await this.db
        .select()
        .from(feedbackClusters)
        .where(eq(feedbackClusters.companyId, companyId));

      const matchedCluster = existing.find((c) => {
        const existingSet = new Set(c.memberIntakeIds as string[]);
        const overlap = memberIds.filter((id) => existingSet.has(id));
        return overlap.length >= Math.ceil(size * 0.5);
      });

      if (matchedCluster) {
        // feedbackClusters IS in the registry — use Drizzle ORM with sql() for Date values
        await this.db
          .update(feedbackClusters)
          .set({
            memberIntakeIds: memberIds,
            clusterSize: size,
            updatedAt: sql`now()`,
          })
          .where(eq(feedbackClusters.id, matchedCluster.id));
      } else {
        await this.db.insert(feedbackClusters).values({
          companyId,
          memberIntakeIds: memberIds,
          clusterSize: size,
          status: "open",
        });
      }

      clustersUpserted++;
    }

    return { clustersUpserted, itemsProcessed: points.length };
  }
}
