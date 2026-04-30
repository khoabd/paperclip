// Integration test for FeedbackClusterer — closes Phase-5 deferred DBSCAN scope.
// Verifies that feedback_* intake_items are clustered into feedback_clusters.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
  entityEmbeddings,
  intakeItems,
  feedbackClusters,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { applyPhase10Tables } from "./helpers/apply-phase10-migrations.js";
import { FeedbackClusterer } from "../feedback-clusterer.js";
import { eq, sql } from "drizzle-orm";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping FeedbackClusterer integration: ${support.reason ?? "unsupported"}`);
}

desc("FeedbackClusterer integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let clusterer!: FeedbackClusterer;
  let companyId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("feedback-clusterer-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    await applyPhase10Tables(db);
    clusterer = new FeedbackClusterer(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM feedback_clusters`);
    await db.execute(sql`DELETE FROM entity_embeddings`);
    await db.execute(sql`DELETE FROM intake_items`);
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
    const prefix = `FC${cid.slice(0, 4).toUpperCase()}`;
    await db.insert(companies).values({
      id: cid,
      name: `FeedbackCo-${cid.slice(0, 6)}`,
      issuePrefix: prefix,
      status: "active",
    });
    return cid;
  }

  async function insertFeedbackItemWithEmbedding(
    cid: string,
    hotIdx: number,
    dim = 16,
    type = "feedback_positive",
  ): Promise<string> {
    const itemId = randomUUID();
    await db.insert(intakeItems).values({
      id: itemId,
      companyId: cid,
      type,
      rawText: `feedback item near axis ${hotIdx}`,
      state: "triaged",
      source: "human_console",
    });

    await db.insert(entityEmbeddings).values({
      companyId: cid,
      entityType: "intake_item",
      entityId: itemId,
      chunkIndex: 0,
      chunkText: `feedback item near axis ${hotIdx}`,
      model: "text-embedding-3-small",
      embedding: makeEmbedding(dim, hotIdx),
    });

    return itemId;
  }

  it("clusters 4 similar feedback items into a single feedback_cluster", async () => {
    companyId = await seedCompany();

    // 4 items near axis 0 — should form a cluster
    for (let i = 0; i < 4; i++) {
      await insertFeedbackItemWithEmbedding(companyId, 0);
    }

    const result = await clusterer.clusterFeedback(companyId, 30);
    expect(result.itemsProcessed).toBeGreaterThanOrEqual(4);
    expect(result.clustersUpserted).toBeGreaterThanOrEqual(1);

    const clusters = await db
      .select()
      .from(feedbackClusters)
      .where(eq(feedbackClusters.companyId, companyId));

    expect(clusters.length).toBeGreaterThanOrEqual(1);
    expect(clusters[0]!.clusterSize).toBeGreaterThanOrEqual(3);
    expect(clusters[0]!.status).toBe("open");
  });

  it("does not cluster non-feedback intake items", async () => {
    companyId = await seedCompany();

    // Insert non-feedback items (type doesn't start with 'feedback')
    for (let i = 0; i < 4; i++) {
      await insertFeedbackItemWithEmbedding(companyId, 0, 16, "feature_request");
    }

    const result = await clusterer.clusterFeedback(companyId, 30);
    expect(result.itemsProcessed).toBe(0);
    expect(result.clustersUpserted).toBe(0);
  });

  it("separates two tight groups into two clusters", async () => {
    companyId = await seedCompany();

    // Group A: 4 items near axis 0
    for (let i = 0; i < 4; i++) {
      await insertFeedbackItemWithEmbedding(companyId, 0);
    }
    // Group B: 4 items near axis 6 (orthogonal)
    for (let i = 0; i < 4; i++) {
      await insertFeedbackItemWithEmbedding(companyId, 6);
    }

    const result = await clusterer.clusterFeedback(companyId, 30);
    expect(result.clustersUpserted).toBe(2);

    const clusters = await db
      .select()
      .from(feedbackClusters)
      .where(eq(feedbackClusters.companyId, companyId));

    expect(clusters.length).toBe(2);
  });

  it("no embeddings → no clusters", async () => {
    companyId = await seedCompany();

    // Insert feedback items without embeddings
    await db.insert(intakeItems).values({
      companyId,
      type: "feedback_negative",
      rawText: "no embedding",
      state: "triaged",
      source: "human_console",
    });

    const result = await clusterer.clusterFeedback(companyId, 30);
    expect(result.itemsProcessed).toBe(0);
    expect(result.clustersUpserted).toBe(0);
  });
});
