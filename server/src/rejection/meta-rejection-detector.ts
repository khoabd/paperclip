// MetaRejectionDetector: detects when the same component_path or feature_key
// appears in 3+ rejection clusters across 30 days and writes a meta-rejection
// row with category='other', sub_category='meta_repeat'.
// Per Phase-10 spec §10.2.

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import type { RejectionStore } from "./rejection-store.js";

export interface MetaDetectionResult {
  metaRowsWritten: number;
  repeatedKeys: string[];
}

type RawClusterRow = {
  id: string;
  company_id: string;
  member_event_ids: string[];
};

type RawEventRow = {
  id: string;
  payload: Record<string, unknown>;
};

export class MetaRejectionDetector {
  constructor(
    private readonly db: Db,
    private readonly store: RejectionStore,
  ) {}

  async detect(companyId: string, days = 30): Promise<MetaDetectionResult> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceIso = since.toISOString();

    // Pull all clusters in the window using raw SQL
    const clustersResult = await this.db.execute<RawClusterRow>(sql`
      SELECT id, company_id, member_event_ids
      FROM rejection_clusters
      WHERE company_id = ${companyId}
        AND created_at >= ${sinceIso}::timestamptz
    `);

    const clusters = Array.from(clustersResult);

    if (clusters.length === 0) {
      return { metaRowsWritten: 0, repeatedKeys: [] };
    }

    // For each cluster, look at member events and extract component_path / feature_key from payload
    const keyToClusterIds = new Map<string, Set<string>>();

    for (const cluster of clusters) {
      const memberIds = cluster.member_event_ids as string[];
      if (memberIds.length === 0) continue;

      // Pull events belonging to this cluster using raw SQL
      const memberIdsLiteral = memberIds.map((id) => `'${id}'`).join(",");
      const eventsResult = await this.db.execute<RawEventRow>(sql`
        SELECT id, payload
        FROM rejection_events
        WHERE id = ANY(ARRAY[${sql.raw(memberIdsLiteral)}]::uuid[])
      `);

      for (const ev of Array.from(eventsResult)) {
        const payload = (ev.payload ?? {}) as Record<string, unknown>;
        const keys: string[] = [];
        if (typeof payload["component_path"] === "string") {
          keys.push(`component_path:${payload["component_path"]}`);
        }
        if (typeof payload["feature_key"] === "string") {
          keys.push(`feature_key:${payload["feature_key"]}`);
        }
        for (const key of keys) {
          if (!keyToClusterIds.has(key)) keyToClusterIds.set(key, new Set());
          keyToClusterIds.get(key)!.add(cluster.id);
        }
      }
    }

    const repeatedKeys: string[] = [];
    let metaRowsWritten = 0;

    for (const [key, clusterIds] of keyToClusterIds) {
      if (clusterIds.size >= 3) {
        repeatedKeys.push(key);
        // Write a meta-rejection row
        await this.store.record({
          companyId,
          category: "other",
          subCategory: "meta_repeat",
          reason: `Repeated failure pattern detected on ${key} across ${clusterIds.size} clusters in ${days} days`,
          severity: 4,
          payload: {
            repeated_key: key,
            cluster_ids: Array.from(clusterIds),
            detection_window_days: days,
          },
        });
        metaRowsWritten++;
      }
    }

    return { metaRowsWritten, repeatedKeys };
  }
}
