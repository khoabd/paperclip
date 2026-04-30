// Integration test for MetaRejectionDetector.
// Gate criterion: 3 clusters touching the same feature_key in payload → meta row written.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { applyPhase10Tables } from "./helpers/apply-phase10-migrations.js";
import { RejectionStore } from "../rejection-store.js";
import { MetaRejectionDetector } from "../meta-rejection-detector.js";
import { sql } from "drizzle-orm";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping MetaRejectionDetector integration: ${support.reason ?? "unsupported"}`);
}

desc("MetaRejectionDetector integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let store!: RejectionStore;
  let detector!: MetaRejectionDetector;
  let companyId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("meta-rejection-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    await applyPhase10Tables(db);
    store = new RejectionStore(db);
    detector = new MetaRejectionDetector(db, store);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM rejection_events`);
    await db.execute(sql`DELETE FROM rejection_clusters`);
    await db.execute(sql`DELETE FROM entity_embeddings`);
    await db.execute(sql`DELETE FROM companies`);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedCompany(): Promise<string> {
    const cid = randomUUID();
    const prefix = `MT${cid.slice(0, 4).toUpperCase()}`;
    await db.insert(companies).values({
      id: cid,
      name: `MetaCo-${cid.slice(0, 6)}`,
      issuePrefix: prefix,
      status: "active",
    });
    return cid;
  }

  async function insertEventWithFeatureKey(
    cid: string,
    featureKey: string,
    daysAgo = 1,
  ): Promise<string> {
    return store.record({
      companyId: cid,
      category: "spec_violation",
      reason: `Failure on ${featureKey}`,
      payload: { feature_key: featureKey },
      occurredAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
    });
  }

  async function insertClusterWithEvents(
    cid: string,
    memberIds: string[],
    daysAgo = 1,
  ): Promise<string> {
    const clusterId = randomUUID();
    const nowIso = new Date().toISOString();
    const createdIso = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const memberIdsLiteral = memberIds.length > 0
      ? memberIds.map((id) => `'${id}'`).join(",")
      : "";
    const memberArray = memberIds.length > 0
      ? sql.raw(`ARRAY[${memberIdsLiteral}]::uuid[]`)
      : sql.raw(`'{}'::uuid[]`);
    await db.execute(sql`
      INSERT INTO rejection_clusters
        (id, company_id, category, member_event_ids, size, status,
         last_recomputed_at, created_at)
      VALUES
        (${clusterId}, ${cid}, 'spec_violation',
         ${memberArray},
         ${memberIds.length}, 'open',
         ${nowIso}::timestamptz,
         ${createdIso}::timestamptz)
    `);
    return clusterId;
  }

  it("3 clusters touching the same feature_key → meta row written", async () => {
    companyId = await seedCompany();

    const FEATURE_KEY = "payment-gateway";

    // Create 3 clusters, each containing events for the same feature_key
    for (let i = 0; i < 3; i++) {
      const evIds: string[] = [];
      for (let j = 0; j < 2; j++) {
        const evId = await insertEventWithFeatureKey(companyId, FEATURE_KEY, i + 1);
        evIds.push(evId);
      }
      await insertClusterWithEvents(companyId, evIds, i + 1);
    }

    const result = await detector.detect(companyId, 30);

    expect(result.metaRowsWritten).toBeGreaterThanOrEqual(1);
    expect(result.repeatedKeys.some((k) => k.includes(FEATURE_KEY))).toBe(true);

    // Verify a meta row was written in rejection_events (use raw SQL — table not in registry)
    type MetaRow = { id: string; severity: number; payload: Record<string, unknown> };
    const metaResult = await db.execute<MetaRow>(sql`
      SELECT id, severity, payload
      FROM rejection_events
      WHERE company_id = ${companyId}
        AND category = 'other'
        AND sub_category = 'meta_repeat'
    `);
    const metaRows = Array.from(metaResult);

    expect(metaRows.length).toBeGreaterThanOrEqual(1);
    const metaRow = metaRows[0]!;
    expect(metaRow.severity).toBe(4);
    const payload = metaRow.payload as Record<string, unknown>;
    expect(payload["repeated_key"]).toContain(FEATURE_KEY);
  });

  it("only 2 clusters touching same feature_key → no meta row", async () => {
    companyId = await seedCompany();

    const FEATURE_KEY = "auth-module";

    // Only 2 clusters — below the threshold of 3
    for (let i = 0; i < 2; i++) {
      const evId = await insertEventWithFeatureKey(companyId, FEATURE_KEY, i + 1);
      await insertClusterWithEvents(companyId, [evId], i + 1);
    }

    const result = await detector.detect(companyId, 30);
    expect(result.metaRowsWritten).toBe(0);
  });

  it("clusters with different feature_keys do not cross-trigger meta detection", async () => {
    companyId = await seedCompany();

    // 3 clusters but each with a different feature_key
    const keys = ["feature-a", "feature-b", "feature-c"];
    for (let i = 0; i < 3; i++) {
      const evId = await insertEventWithFeatureKey(companyId, keys[i]!, i + 1);
      await insertClusterWithEvents(companyId, [evId], i + 1);
    }

    const result = await detector.detect(companyId, 30);
    expect(result.metaRowsWritten).toBe(0);
  });

  it("no clusters → no meta rows", async () => {
    companyId = await seedCompany();
    const result = await detector.detect(companyId, 30);
    expect(result.metaRowsWritten).toBe(0);
    expect(result.repeatedKeys).toEqual([]);
  });
});
