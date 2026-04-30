// TC-INT-DRAGIN-01: drag-in self-report aggregation per ADR-0008.
// Verifies aggregate query computes drag_in_rate per workspace per week and that
// EfficiencyReviewer recommends the right autonomy adjustment per threshold band.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { approvals, companies, createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { DragInAggregator, EfficiencyReviewer } from "../dragin-aggregator.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping DragInAggregator integration: ${support.reason ?? "unsupported"}`);
}

desc("DragInAggregator + EfficiencyReviewer — TC-INT-DRAGIN-01", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let companyId!: string;

  // Anchor every approval to mid-week so weekStart math is unambiguous.
  const WEEK_ANCHOR = new Date("2026-04-15T12:00:00.000Z"); // Wednesday
  const WEEK_START = new Date("2026-04-12T00:00:00.000Z"); // Sunday before

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("dragin-agg-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);

    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Dragin Co",
      status: "active",
      autonomyLevel: "supervised",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterEach(async () => {
    await db.delete(approvals);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedApprovals(opts: { total: number; dragInCount: number }) {
    const rows = [];
    for (let i = 0; i < opts.total; i++) {
      rows.push({
        id: randomUUID(),
        companyId,
        type: "code_change",
        payload: { action: { kind: "deploy", summary: `decision-${i}` } },
        status: i % 2 === 0 ? "approved" : "rejected",
        decidedAt: WEEK_ANCHOR,
        decidedByUserId: "user-1",
        metadata: i < opts.dragInCount ? { dragIn: true } : { dragIn: false },
        createdAt: WEEK_ANCHOR,
        updatedAt: WEEK_ANCHOR,
      });
    }
    if (rows.length > 0) await db.insert(approvals).values(rows);
  }

  it("aggregateForWeek: 20 total, 2 drag-in → rate = 10%", async () => {
    await seedApprovals({ total: 20, dragInCount: 2 });

    const aggregator = new DragInAggregator(db);
    const result = await aggregator.aggregateForWeek({ companyId, weekStart: WEEK_ANCHOR });

    expect(result.totalApprovals).toBe(20);
    expect(result.dragInCount).toBe(2);
    expect(result.dragInRate).toBeCloseTo(0.1, 4);
    expect(result.weekStart.toISOString()).toBe(WEEK_START.toISOString());
  });

  it("Case A — rate < 10% with sample → recommend bump_autonomy", async () => {
    await seedApprovals({ total: 20, dragInCount: 1 }); // 5%

    const reviewer = new EfficiencyReviewer(db);
    const { recommendation, aggregate } = await reviewer.recommendForWorkspace({
      companyId,
      weekStart: WEEK_ANCHOR,
    });
    expect(aggregate.dragInRate).toBeCloseTo(0.05, 4);
    expect(recommendation.kind).toBe("bump_autonomy");
  });

  it("Case B — rate ≥ 20% → recommend auditor_review", async () => {
    await seedApprovals({ total: 20, dragInCount: 5 }); // 25%

    const reviewer = new EfficiencyReviewer(db);
    const { recommendation } = await reviewer.recommendForWorkspace({
      companyId,
      weekStart: WEEK_ANCHOR,
    });
    expect(recommendation.kind).toBe("auditor_review");
  });

  it("Edge — 0% rate → no_action (hold steady)", async () => {
    await seedApprovals({ total: 20, dragInCount: 0 }); // 0%

    const reviewer = new EfficiencyReviewer(db);
    const { recommendation } = await reviewer.recommendForWorkspace({
      companyId,
      weekStart: WEEK_ANCHOR,
    });
    expect(recommendation.kind).toBe("no_action");
  });

  it("Edge — 100% rate → critical_alert", async () => {
    await seedApprovals({ total: 10, dragInCount: 10 }); // 100%

    const reviewer = new EfficiencyReviewer(db);
    const { recommendation, aggregate } = await reviewer.recommendForWorkspace({
      companyId,
      weekStart: WEEK_ANCHOR,
    });
    expect(aggregate.dragInRate).toBe(1);
    expect(recommendation.kind).toBe("critical_alert");
  });

  it("Edge — sample < 5 → no_action regardless of rate", async () => {
    await seedApprovals({ total: 3, dragInCount: 1 }); // 33% but tiny sample

    const reviewer = new EfficiencyReviewer(db);
    const { recommendation } = await reviewer.recommendForWorkspace({
      companyId,
      weekStart: WEEK_ANCHOR,
    });
    expect(recommendation.kind).toBe("no_action");
    expect(recommendation.reason).toContain("sample too small");
  });

  it("aggregate respects week boundaries — out-of-window approvals excluded", async () => {
    // Seed in current week
    await seedApprovals({ total: 10, dragInCount: 1 });

    // Insert a row 2 weeks earlier with high drag-in — must NOT pollute current-week aggregate.
    const farPast = new Date(WEEK_ANCHOR.getTime() - 14 * 24 * 3_600_000);
    await db.insert(approvals).values({
      id: randomUUID(),
      companyId,
      type: "code_change",
      payload: { action: { kind: "deploy", summary: "old" } },
      status: "approved",
      decidedAt: farPast,
      decidedByUserId: "user-1",
      metadata: { dragIn: true },
      createdAt: farPast,
      updatedAt: farPast,
    });

    const aggregator = new DragInAggregator(db);
    const result = await aggregator.aggregateForWeek({ companyId, weekStart: WEEK_ANCHOR });
    expect(result.totalApprovals).toBe(10); // only this week's rows
    expect(result.dragInCount).toBe(1);
  });
});
