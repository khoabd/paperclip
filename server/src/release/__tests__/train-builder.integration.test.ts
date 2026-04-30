// SM-10: Train builder dry-run.
// Verifies dryRun produces a grouping without writing to release_trains; a real
// run persists, and the planner groups deterministically.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companies, createDb, releaseTrains } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { TrainBuilder } from "../train-builder.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping TrainBuilder integration: ${support.reason ?? "unsupported"}`);
}

desc("TrainBuilder — SM-10", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let companyId!: string;
  const FROZEN_NOW = new Date("2026-04-30T08:00:00.000Z");

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("train-builder-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Train Co",
      status: "active",
      autonomyLevel: "supervised",
      issuePrefix: `TRN-${companyId.slice(0, 6)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterEach(async () => {
    await db.delete(releaseTrains);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it("dryRun returns proposed trains and writes nothing to release_trains", async () => {
    const builder = new TrainBuilder(db, () => FROZEN_NOW);
    const result = await builder.run({
      companyId,
      dryRun: true,
      candidates: [
        { key: "feat-a" },
        { key: "feat-b" },
        { key: "feat-c" },
        { key: "feat-d" },
        { key: "feat-e" },
      ],
    });

    expect(result.proposedTrains.length).toBeGreaterThan(0);
    expect(result.persistedCount).toBe(0);

    const rows = await db.select().from(releaseTrains).where(eq(releaseTrains.companyId, companyId));
    expect(rows).toHaveLength(0);
  });

  it("non-dryRun persists every proposed train with rationale", async () => {
    const builder = new TrainBuilder(db, () => FROZEN_NOW);
    const result = await builder.run({
      companyId,
      candidates: [{ key: "feat-a" }, { key: "feat-b" }],
    });

    expect(result.proposedTrains).toHaveLength(1);
    expect(result.persistedCount).toBe(1);

    const rows = await db.select().from(releaseTrains).where(eq(releaseTrains.companyId, companyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].featureKeys).toEqual(["feat-a", "feat-b"]);
    expect(rows[0].mintedBy).toBe("auto");
  });

  it("plan: high-risk features get their own train (solo)", () => {
    const builder = new TrainBuilder(db, () => FROZEN_NOW);
    const plan = builder.plan([
      { key: "safe-1" },
      { key: "safe-2" },
      { key: "risky-1", risk: "high" },
      { key: "risky-2", risk: "high" },
    ]);
    const soloPlans = plan.filter((p) => p.featureKeys.length === 1);
    const groupedPlans = plan.filter((p) => p.featureKeys.length > 1);
    expect(soloPlans.map((p) => p.featureKeys[0]).sort()).toEqual(["risky-1", "risky-2"]);
    expect(groupedPlans).toHaveLength(1);
    expect(groupedPlans[0].featureKeys.sort()).toEqual(["safe-1", "safe-2"]);
  });

  it("plan: features grouped by trainHint", () => {
    const builder = new TrainBuilder(db, () => FROZEN_NOW);
    const plan = builder.plan([
      { key: "auth-a", trainHint: "auth" },
      { key: "auth-b", trainHint: "auth" },
      { key: "ui-a", trainHint: "ui" },
      { key: "ui-b", trainHint: "ui" },
    ]);

    const authTrain = plan.find((p) => p.featureKeys.includes("auth-a"));
    const uiTrain = plan.find((p) => p.featureKeys.includes("ui-a"));
    expect(authTrain?.featureKeys.sort()).toEqual(["auth-a", "auth-b"]);
    expect(uiTrain?.featureKeys.sort()).toEqual(["ui-a", "ui-b"]);
    expect(authTrain).not.toBe(uiTrain);
  });

  it("plan: bucket overflow splits into multiple trains beyond cap (4)", () => {
    const builder = new TrainBuilder(db, () => FROZEN_NOW);
    const plan = builder.plan([
      { key: "a", trainHint: "x" },
      { key: "b", trainHint: "x" },
      { key: "c", trainHint: "x" },
      { key: "d", trainHint: "x" },
      { key: "e", trainHint: "x" },
      { key: "f", trainHint: "x" },
    ]);

    const xTrains = plan.filter((p) => p.rationale.includes("group=x"));
    expect(xTrains).toHaveLength(2);
    const total = xTrains.reduce((s, p) => s + p.featureKeys.length, 0);
    expect(total).toBe(6);
    for (const t of xTrains) {
      expect(t.featureKeys.length).toBeLessThanOrEqual(4);
    }
  });

  it("empty candidates → empty proposal, no persistence even when dryRun=false", async () => {
    const builder = new TrainBuilder(db, () => FROZEN_NOW);
    const result = await builder.run({ companyId, candidates: [] });
    expect(result.proposedTrains).toHaveLength(0);
    expect(result.persistedCount).toBe(0);
  });

  it("after dryRun, follow-up real run still works (planner is stateless)", async () => {
    const builder = new TrainBuilder(db, () => FROZEN_NOW);
    const dryResult = await builder.run({
      companyId,
      dryRun: true,
      candidates: [{ key: "feat-x" }],
    });
    expect(dryResult.persistedCount).toBe(0);

    const realResult = await builder.run({
      companyId,
      candidates: [{ key: "feat-x" }],
    });
    expect(realResult.persistedCount).toBe(1);
    const rows = await db.select().from(releaseTrains).where(eq(releaseTrains.companyId, companyId));
    expect(rows).toHaveLength(1);
  });
});
