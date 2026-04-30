// IntakePromotionBridge: promotes a rejection cluster to a strategic_input intake item.
// Calls IntakeStore.create() from Phase 5 — no Phase-5 code is modified.
// Per Phase-10 spec §10.2.
//
// NOTE: rejection_clusters is not yet in the Drizzle schema registry. All DML
// uses db.execute(sql`...`) to avoid binary-mode type serialization issues.

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { IntakeStore } from "../intake/intake-store.js";

export interface PromoteResult {
  intakeId: string;
  clusterId: string;
}

type RawClusterRow = {
  id: string;
  company_id: string;
  status: string;
  category: string | null;
  label: string | null;
  size: number;
  auto_action: string | null;
  member_event_ids: string[];
  escalated_to_intake_id: string | null;
};

type RawEventRow = {
  id: string;
  category: string;
  reason: string | null;
};

export class IntakePromotionBridge {
  private readonly intakeStore: IntakeStore;

  constructor(private readonly db: Db) {
    this.intakeStore = new IntakeStore(db);
  }

  async promoteCluster(clusterId: string): Promise<PromoteResult> {
    // Fetch cluster via raw SQL (table not yet in Drizzle registry)
    const clusterRows = await this.db.execute<RawClusterRow>(sql`
      SELECT id, company_id, status, category, label, size, auto_action,
             member_event_ids, escalated_to_intake_id
      FROM rejection_clusters
      WHERE id = ${clusterId}
      LIMIT 1
    `);

    const cluster = Array.from(clusterRows)[0];

    if (!cluster) {
      throw new Error(`Cluster not found: ${clusterId}`);
    }

    if (cluster.status !== "open") {
      throw new Error(
        `Cluster ${clusterId} is already ${cluster.status} — cannot promote again`,
      );
    }

    // Fetch member rejection events to build spec summary
    const memberIds = cluster.member_event_ids as string[];
    let memberEvents: RawEventRow[] = [];

    if (memberIds.length > 0) {
      const memberIdsLiteral = memberIds.map((id) => `'${id}'`).join(",");
      const eventsResult = await this.db.execute<RawEventRow>(sql`
        SELECT id, category, reason
        FROM rejection_events
        WHERE id = ANY(ARRAY[${sql.raw(memberIdsLiteral)}]::uuid[])
        LIMIT ${memberIds.length + 5}
      `);
      memberEvents = Array.from(eventsResult);
    }

    const spec = buildClusterSpec(cluster, memberEvents, memberIds.length);

    const intakeId = await this.intakeStore.create({
      companyId: cluster.company_id,
      type: "strategic_input",
      rawText: spec,
      title: `Auto-promoted: ${cluster.category ?? "rejection"} cluster (${cluster.size} events)`,
      source: "auto_promoted",
      sourceRef: clusterId,
      spec,
    });

    // Update cluster status via raw SQL
    await this.db.execute(sql`
      UPDATE rejection_clusters
      SET status = 'escalated',
          escalated_to_intake_id = ${intakeId}
      WHERE id = ${clusterId}
    `);

    return { intakeId, clusterId };
  }
}

function buildClusterSpec(
  cluster: RawClusterRow,
  memberEvents: Array<{ category: string; reason: string | null }>,
  totalMembers: number,
): string {
  const category = cluster.category ?? "other";
  const size = cluster.size;
  const lines: string[] = [
    `This strategic input was automatically promoted from a rejection cluster containing ${size} rejection event(s) in the "${category}" category.`,
    "",
    `Recommended auto-action: ${cluster.auto_action ?? "notify"}.`,
    "",
    "Sample rejection reasons from this cluster:",
  ];

  const samples = memberEvents
    .filter((e) => e.reason)
    .slice(0, 5);

  if (samples.length > 0) {
    for (const ev of samples) {
      lines.push(`  - [${ev.category ?? category}] ${ev.reason}`);
    }
  } else {
    lines.push("  (no reason text captured — see payload for structured data)");
  }

  lines.push(
    "",
    "Action required: Review this recurring rejection pattern and decide whether to adjust system prompts, principles, or escalate to roadmap.",
  );

  return lines.join("\n");
}
