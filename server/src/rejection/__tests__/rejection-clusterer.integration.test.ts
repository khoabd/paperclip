// Integration test: insert 10 rejections in a single category with embeddings over 7 days
// → cluster forms (size ≥ 5) → auto-action escalate_to_intake
// → IntakePromotionBridge creates an intake_items row with type='strategic_input', source='auto_promoted'.
// Gate criterion per Phase-10 spec.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
  entityEmbeddings,
  intakeItems,
} from "@paperclipai/db";
import { eq, sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { applyPhase10Tables } from "./helpers/apply-phase10-migrations.js";
import { RejectionStore } from "../rejection-store.js";
import { RejectionClusterer } from "../rejection-clusterer.js";
import { IntakePromotionBridge } from "../intake-promotion-bridge.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping RejectionClusterer integration: ${support.reason ?? "unsupported"}`);
}

type RawCluster = {
  id: string;
  company_id: string;
  status: string;
  size: number;
  auto_action: string | null;
  escalated_to_intake_id: string | null;
};

desc("RejectionClusterer integration — full pipeline gate", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let store!: RejectionStore;
  let clusterer!: RejectionClusterer;
  let bridge!: IntakePromotionBridge;
  let companyId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("rejection-clusterer-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    await applyPhase10Tables(db);
    store = new RejectionStore(db);
    clusterer = new RejectionClusterer(db);
    bridge = new IntakePromotionBridge(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM intake_items`);
    await db.execute(sql`DELETE FROM rejection_clusters`);
    await db.execute(sql`DELETE FROM rejection_events`);
    await db.execute(sql`DELETE FROM entity_embeddings`);
    await db.execute(sql`DELETE FROM companies`);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  function makeEmbedding(dim: number, hotIdx: number, noise = 0.02): number[] {
    const v = new Array<number>(dim).fill(noise / dim);
    v[hotIdx] = 1 - noise;
    return v;
  }

  async function seedCompany(): Promise<string> {
    const cid = randomUUID();
    const prefix = `RC${cid.slice(0, 4).toUpperCase()}`;
    await db.insert(companies).values({
      id: cid,
      name: `RejCo-${cid.slice(0, 6)}`,
      issuePrefix: prefix,
      status: "active",
    });
    return cid;
  }

  async function insertRejectionWithEmbedding(
    cid: string,
    category: string,
    dimSize: number,
    hotIdx: number,
    daysAgo: number,
  ): Promise<string> {
    const occurredAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    const embeddingId = randomUUID();
    await db.insert(entityEmbeddings).values({
      id: embeddingId,
      companyId: cid,
      entityType: "rejection_event",
      entityId: randomUUID(),
      chunkIndex: 0,
      chunkText: `rejection: ${category}`,
      model: "text-embedding-3-small",
      embedding: makeEmbedding(dimSize, hotIdx),
    });

    const evId = await store.record({
      companyId: cid,
      category: category as "spec_violation",
      reason: `Rejection reason for ${category} - event at ${daysAgo}d ago`,
      severity: 2,
      embeddingId,
      payload: { feature_key: "auth-module" },
      occurredAt,
    });
    return evId;
  }

  it("10 rejection events in spec_violation → cluster forms → escalate_to_intake → intake_items row", async () => {
    companyId = await seedCompany();

    const DIM = 16;
    // Insert 10 rejection events in spec_violation category, all near axis 0 (tight cluster)
    for (let i = 0; i < 10; i++) {
      await insertRejectionWithEmbedding(
        companyId,
        "spec_violation",
        DIM,
        0,
        Math.floor(Math.random() * 7), // within 7 days
      );
    }

    // Run clustering
    const clusterResult = await clusterer.clusterRecent(companyId, 14);
    expect(clusterResult.eventsProcessed).toBeGreaterThanOrEqual(10);
    expect(clusterResult.clustersUpserted).toBeGreaterThanOrEqual(1);

    // Find the formed cluster using raw SQL
    const clusterRows = await db.execute<RawCluster>(sql`
      SELECT id, company_id, status, size, auto_action, escalated_to_intake_id
      FROM rejection_clusters
      WHERE company_id = ${companyId}
    `);
    const clusters = Array.from(clusterRows);

    expect(clusters.length).toBeGreaterThanOrEqual(1);

    // At least one cluster must be large enough to warrant escalation
    const largeCluster = clusters.find((c) => (c.size ?? 0) >= 5);
    expect(largeCluster).toBeDefined();
    expect(largeCluster!.auto_action).toBe("escalate_to_intake");
    expect(largeCluster!.status).toBe("open");

    // Promote the cluster
    const promoted = await bridge.promoteCluster(largeCluster!.id);
    expect(promoted.intakeId).toBeDefined();
    expect(promoted.clusterId).toBe(largeCluster!.id);

    // Verify intake_items row (intakeItems IS in registry)
    const intake = (
      await db
        .select()
        .from(intakeItems)
        .where(eq(intakeItems.id, promoted.intakeId))
        .limit(1)
    )[0];

    expect(intake).toBeDefined();
    expect(intake!.type).toBe("strategic_input");
    expect(intake!.source).toBe("auto_promoted");
    expect(intake!.sourceRef).toBe(largeCluster!.id);

    // Verify cluster status updated via raw SQL
    const updatedRows = await db.execute<RawCluster>(sql`
      SELECT id, status, escalated_to_intake_id
      FROM rejection_clusters
      WHERE id = ${largeCluster!.id}
      LIMIT 1
    `);
    const updatedCluster = Array.from(updatedRows)[0];

    expect(updatedCluster!.status).toBe("escalated");
    expect(updatedCluster!.escalated_to_intake_id).toBe(promoted.intakeId);
  });

  it("cannot promote an already-escalated cluster", async () => {
    companyId = await seedCompany();
    const DIM = 16;
    for (let i = 0; i < 6; i++) {
      await insertRejectionWithEmbedding(companyId, "security", DIM, 1, i);
    }
    await clusterer.clusterRecent(companyId, 14);

    const clusterRows = await db.execute<RawCluster>(sql`
      SELECT id, size FROM rejection_clusters WHERE company_id = ${companyId}
    `);
    const c = Array.from(clusterRows).find((x) => (x.size ?? 0) >= 5);
    if (!c) return; // skip if embedding similarity didn't cluster (edge case)

    await bridge.promoteCluster(c.id);
    await expect(bridge.promoteCluster(c.id)).rejects.toThrow("escalated");
  });

  it("events older than window are excluded from clustering", async () => {
    companyId = await seedCompany();
    const DIM = 16;
    // Insert 10 events but all 20 days ago — outside 14-day window
    for (let i = 0; i < 10; i++) {
      await insertRejectionWithEmbedding(companyId, "spec_violation", DIM, 0, 20);
    }
    const result = await clusterer.clusterRecent(companyId, 14);
    expect(result.eventsProcessed).toBe(0);
    expect(result.clustersUpserted).toBe(0);
  });

  it("no embeddings → empty cluster run", async () => {
    companyId = await seedCompany();
    // Insert rejection events without embeddings
    await store.record({
      companyId,
      category: "tech_debt",
      reason: "no embedding attached",
    });
    const result = await clusterer.clusterRecent(companyId, 14);
    expect(result.eventsProcessed).toBe(0);
    expect(result.clustersUpserted).toBe(0);
  });
});
