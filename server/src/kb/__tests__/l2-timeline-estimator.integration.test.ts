// Integration test: L2TimelineEstimator.
// Gate criterion: seed 5 historical intakes with outcomes → estimate a new intake →
// assert L2 row written with source='monte_carlo'.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import {
  companies,
  createDb,
  intakeItems,
  intakeWorkflowStates,
  intakeSolutions,
  intakeTimelineEstimates,
  intakeOutcomeTracker,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { L2TimelineEstimator } from "../l2-timeline-estimator.js";
import { IntakeStore } from "../../intake/intake-store.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping L2TimelineEstimator integration: ${support.reason ?? "unsupported"}`);
}

desc("L2TimelineEstimator integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let estimator!: L2TimelineEstimator;
  let store!: IntakeStore;
  let companyId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("l2-estimator-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    estimator = new L2TimelineEstimator(db);
    store = new IntakeStore(db);
  });

  afterEach(async () => {
    await db.delete(intakeTimelineEstimates);
    await db.delete(intakeOutcomeTracker);
    await db.delete(intakeSolutions);
    await db.delete(intakeWorkflowStates);
    await db.delete(intakeItems);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedWorkspace(): Promise<void> {
    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "L2EstimatorCo",
      issuePrefix: `L2${companyId.slice(0, 4).toUpperCase()}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Seeds N historical intakes of given type with known actual outcome days.
   */
  async function seedHistoricalIntakes(
    type: string,
    actualDaysValues: number[],
  ): Promise<void> {
    for (const actualDays of actualDaysValues) {
      const intakeId = await store.create({
        companyId,
        type: type as "feature_request" | "problem" | "bug_report",
        rawText: `Historical ${type} intake`,
        title: `History`,
        priority: "P1",
      });
      // Pre-allocate and close with known actual
      await store.preallocateOutcomeTracker(intakeId, actualDays, actualDays * 100);
      await db
        .update(intakeOutcomeTracker)
        .set({
          actualDays: actualDays.toString(),
          acceptanceStatus: "accepted",
          measuredAt: new Date(),
        })
        .where(eq(intakeOutcomeTracker.intakeId, intakeId));
      await store.close(intakeId, "accepted");
    }
  }

  it("writes an L2 row with source=monte_carlo when historical data exists", async () => {
    await seedWorkspace();

    // Seed 5 historical feature_request intakes with actual days
    await seedHistoricalIntakes("feature_request", [5, 8, 10, 12, 15]);

    // Create the target intake
    const targetId = await store.create({
      companyId,
      type: "feature_request",
      rawText: "New feature intake for L2 estimation",
      title: "New Feature",
      priority: "P1",
    });

    const result = await estimator.estimate(targetId);

    expect(result.p50).toBeGreaterThan(0);
    expect(result.p90).toBeGreaterThanOrEqual(result.p50);
    expect(result.sampleSize).toBe(5);
    expect(result.timelineRowId).toBeDefined();

    // Verify the DB row
    const rows = await db
      .select()
      .from(intakeTimelineEstimates)
      .where(
        and(
          eq(intakeTimelineEstimates.intakeId, targetId),
          eq(intakeTimelineEstimates.level, "L2"),
          eq(intakeTimelineEstimates.source, "monte_carlo"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.level).toBe("L2");
    expect(rows[0]!.source).toBe("monte_carlo");
    expect(Number(rows[0]!.p50Days)).toBeGreaterThan(0);
    expect(Number(rows[0]!.p90Days)).toBeGreaterThanOrEqual(Number(rows[0]!.p50Days));
  });

  it("falls back to type prior when no historical data and still writes L2 row", async () => {
    await seedWorkspace();

    const targetId = await store.create({
      companyId,
      type: "bug_report",
      rawText: "Bug with no history",
      title: "Bug",
      priority: "P2",
    });

    const result = await estimator.estimate(targetId);

    expect(result.sampleSize).toBe(0);
    expect(result.p50).toBeGreaterThan(0);
    expect(result.p90).toBeGreaterThanOrEqual(result.p50);

    const rows = await db
      .select()
      .from(intakeTimelineEstimates)
      .where(eq(intakeTimelineEstimates.intakeId, targetId));
    const l2 = rows.find((r) => r.level === "L2" && r.source === "monte_carlo");
    expect(l2).toBeDefined();
  });

  it("p90 is always >= p50", async () => {
    await seedWorkspace();
    await seedHistoricalIntakes("problem", [2, 3, 5, 7, 14]);

    const targetId = await store.create({
      companyId,
      type: "problem",
      rawText: "A problem",
      title: "Problem",
      priority: "P0",
    });

    const result = await estimator.estimate(targetId);
    expect(result.p90).toBeGreaterThanOrEqual(result.p50);
  });

  it("throws when intake id does not exist", async () => {
    await seedWorkspace();
    await expect(estimator.estimate(randomUUID())).rejects.toThrow("Intake not found");
  });

  it("Monte Carlo output is probabilistically sensible: p50 within 10x of historical mean", async () => {
    await seedWorkspace();

    const historicalDays = [8, 9, 10, 11, 12];
    await seedHistoricalIntakes("feature_request", historicalDays);

    const targetId = await store.create({
      companyId,
      type: "feature_request",
      rawText: "Another feature",
      title: "Feature",
      priority: "P1",
    });

    const result = await estimator.estimate(targetId);
    const mean = historicalDays.reduce((a, b) => a + b, 0) / historicalDays.length; // 10

    // p50 should be in a plausible range given Monte Carlo factors
    expect(result.p50).toBeLessThan(mean * 10);
    expect(result.p50).toBeGreaterThan(mean / 10);
  });
});
