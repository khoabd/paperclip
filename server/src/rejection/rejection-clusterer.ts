// RejectionClusterer: pulls rejection_events with embeddings, runs DBSCAN,
// upserts rejection_clusters rows.
// Per Phase-10 spec §10.2.
//
// NOTE: rejection_events and rejection_clusters are not yet in the Drizzle
// schema registry (pending orchestrator merge of schema/index.ts). All DML
// on those tables uses db.execute(sql`...`) to avoid postgres.js binary-mode
// type serialization issues with unregistered timestamp columns.

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { entityEmbeddings } from "@paperclipai/db";
import { rejectionEvents } from "@paperclipai/db/schema/rejection_events";
import { rejectionClusters } from "@paperclipai/db/schema/rejection_clusters";
import { DBSCANClusterer, computeCentroid } from "./dbscan-clusterer.js";
import { AutoActionPolicy } from "./auto-action-policy.js";

export interface ClusterRunResult {
  clustersUpserted: number;
  eventsProcessed: number;
}

type RawRejectionEventRow = {
  id: string;
  company_id: string;
  embedding_id: string | null;
  category: string;
  occurred_at: string;
};

type RawClusterRow = {
  id: string;
  company_id: string;
  status: string;
  member_event_ids: string[];
};

export class RejectionClusterer {
  private readonly dbscan = new DBSCANClusterer(0.25, 3);
  private readonly policy = new AutoActionPolicy();

  constructor(private readonly db: Db) {}

  async clusterRecent(
    companyId: string,
    days = 14,
  ): Promise<ClusterRunResult> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceIso = since.toISOString();

    // Pull events that have embeddings using raw SQL to avoid type mapping issues
    const eventsResult = await this.db.execute<RawRejectionEventRow>(sql`
      SELECT id, company_id, embedding_id, category, occurred_at
      FROM rejection_events
      WHERE company_id = ${companyId}
        AND occurred_at >= ${sinceIso}::timestamptz
        AND embedding_id IS NOT NULL
    `);

    const events = Array.from(eventsResult);

    if (events.length === 0) {
      return { clustersUpserted: 0, eventsProcessed: 0 };
    }

    // Fetch embeddings for each event
    const embeddingIds = events
      .map((e) => e.embedding_id)
      .filter((id): id is string => id != null);

    const embRows = embeddingIds.length > 0
      ? await this.db
          .select()
          .from(entityEmbeddings)
          .where(inArray(entityEmbeddings.id, embeddingIds))
      : [];

    const embeddingMap = new Map(embRows.map((r) => [r.id, r.embedding as number[]]));

    // Build points array — only include events with a resolved embedding
    const points = events
      .filter((e) => e.embedding_id && embeddingMap.has(e.embedding_id))
      .map((e) => ({
        id: e.id,
        embedding: embeddingMap.get(e.embedding_id!)!,
        category: e.category,
      }));

    if (points.length === 0) {
      return { clustersUpserted: 0, eventsProcessed: 0 };
    }

    const result = this.dbscan.cluster(points);

    // Group by cluster index
    const clusterGroups = new Map<number, typeof points>();
    for (const pt of points) {
      const cIdx = result.assignments.get(pt.id) ?? -1;
      if (cIdx === -1) continue; // noise
      if (!clusterGroups.has(cIdx)) clusterGroups.set(cIdx, []);
      clusterGroups.get(cIdx)!.push(pt);
    }

    const nowIso = new Date().toISOString();
    let clustersUpserted = 0;

    for (const [, members] of clusterGroups) {
      const memberIds = members.map((m) => m.id);
      const category = members[0]?.category ?? "other";
      const size = members.length;
      const autoAction = this.policy.decide({ category, size, windowDays: days });

      // Check if an existing open cluster overlaps significantly with these members
      const existingResult = await this.db.execute<RawClusterRow>(sql`
        SELECT id, company_id, status, member_event_ids
        FROM rejection_clusters
        WHERE company_id = ${companyId} AND status = 'open'
      `);
      const existing = Array.from(existingResult);

      const matchedCluster = existing.find((c) => {
        const existingMemberSet = new Set(c.member_event_ids as string[]);
        const overlap = memberIds.filter((id) => existingMemberSet.has(id));
        return overlap.length >= Math.ceil(size * 0.5);
      });

      // Compute centroid embedding (kept for future use)
      computeCentroid(members.map((m) => m.embedding));

      const memberIdsLiteral = memberIds.map((id) => `'${id}'`).join(",");

      if (matchedCluster) {
        // Update existing cluster using raw SQL
        await this.db.execute(sql`
          UPDATE rejection_clusters
          SET member_event_ids = ARRAY[${sql.raw(memberIdsLiteral)}]::uuid[],
              size = ${size},
              category = ${category},
              auto_action = ${autoAction},
              last_recomputed_at = ${nowIso}::timestamptz
          WHERE id = ${matchedCluster.id}
        `);
      } else {
        // Insert new cluster using raw SQL
        await this.db.execute(sql`
          INSERT INTO rejection_clusters
            (company_id, category, member_event_ids, size, status, auto_action,
             last_recomputed_at, created_at)
          VALUES
            (${companyId}, ${category},
             ARRAY[${sql.raw(memberIdsLiteral)}]::uuid[],
             ${size}, 'open', ${autoAction},
             ${nowIso}::timestamptz, ${nowIso}::timestamptz)
        `);
      }

      clustersUpserted++;
    }

    return { clustersUpserted, eventsProcessed: points.length };
  }
}
