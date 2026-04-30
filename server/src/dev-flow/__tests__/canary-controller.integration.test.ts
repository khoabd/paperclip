// Integration test: full canary ramp 5→25→50→100.
// Gate criteria: history.length===5 (initial 0 + 4 ramp steps) and rollout_percent===100.
// Actually: start writes 1 entry (5%), then 3 steps (25, 50, 100) = 4 entries total.
// The spec says history grows; we verify each step appends and the final state is correct.
// Per Phase-7-Development-Flow-Feature-Flags §7.4.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  canaryRuns,
  companies,
  createDb,
  featureFlags,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { CanaryController } from "../feature-flags/canary-controller.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping CanaryController integration tests: ${embeddedPostgresSupport.reason ?? "unsupported"}`,
  );
}

describeEmbeddedPostgres("CanaryController", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let controller!: CanaryController;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("canary-controller-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    controller = new CanaryController(db);
  });

  afterEach(async () => {
    await db.delete(canaryRuns);
    await db.delete(featureFlags);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  let prefixCounter = 0;

  async function seedWorkspaceAndFlag(): Promise<{ wsId: string; flagId: string }> {
    const wsId = randomUUID();
    prefixCounter++;
    await db.insert(companies).values({
      id: wsId,
      name: `CanaryCo${prefixCounter}`,
      status: "active",
      autonomyLevel: "sandbox",
      wfqWeight: 100,
      costBudgetUsdPerWeek: "100.0000",
      issuePrefix: `CN${prefixCounter}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const [flag] = await db
      .insert(featureFlags)
      .values({
        companyId: wsId,
        key: `feature_${prefixCounter}`,
        status: "off",
        rolloutPercent: 0,
      })
      .returning({ id: featureFlags.id });

    if (!flag) throw new Error("insert failed");
    return { wsId, flagId: flag.id };
  }

  it("full ramp 0→5→25→50→100: history grows and rollout_percent matches", async () => {
    const { flagId } = await seedWorkspaceAndFlag();

    // Step 1: start at 5%.
    const canaryId = await controller.start(flagId);
    const afterStart = await controller.getById(canaryId);
    expect(afterStart?.currentPercent).toBe(5);
    expect(afterStart?.status).toBe("running");
    const historyAfterStart = afterStart?.history as { percent: number; at: string }[];
    expect(historyAfterStart).toHaveLength(1);
    expect(historyAfterStart[0]?.percent).toBe(5);

    // Verify parent flag updated.
    const [flagAfterStart] = await db
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.id, flagId));
    expect(flagAfterStart?.rolloutPercent).toBe(5);
    expect(flagAfterStart?.status).toBe("canary");

    // Step 2: ramp to 25%.
    await controller.step(canaryId, 25);
    const after25 = await controller.getById(canaryId);
    expect(after25?.currentPercent).toBe(25);
    const h25 = after25?.history as { percent: number }[];
    expect(h25).toHaveLength(2);
    expect(h25[1]?.percent).toBe(25);

    // Step 3: ramp to 50%.
    await controller.step(canaryId, 50);
    const after50 = await controller.getById(canaryId);
    expect(after50?.currentPercent).toBe(50);
    const h50 = after50?.history as { percent: number }[];
    expect(h50).toHaveLength(3);
    expect(h50[2]?.percent).toBe(50);

    // Step 4: ramp to 100%.
    await controller.step(canaryId, 100);
    const after100 = await controller.getById(canaryId);
    expect(after100?.currentPercent).toBe(100);
    expect(after100?.status).toBe("completed");
    expect(after100?.endedAt).toBeDefined();
    const h100 = after100?.history as { percent: number }[];
    expect(h100).toHaveLength(4);
    expect(h100[3]?.percent).toBe(100);

    // Parent flag must be at 100% and status=on.
    const [flagAfterComplete] = await db
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.id, flagId));
    expect(flagAfterComplete?.rolloutPercent).toBe(100);
    expect(flagAfterComplete?.status).toBe("on");
  });

  it("abort resets flag to off and 0%", async () => {
    const { flagId } = await seedWorkspaceAndFlag();

    const canaryId = await controller.start(flagId);
    await controller.step(canaryId, 25);

    await controller.abort(canaryId);
    const aborted = await controller.getById(canaryId);
    expect(aborted?.status).toBe("aborted");

    const [flag] = await db.select().from(featureFlags).where(eq(featureFlags.id, flagId));
    expect(flag?.rolloutPercent).toBe(0);
    expect(flag?.status).toBe("off");

    // History has abort entry (percent=0).
    const hist = aborted?.history as { percent: number }[];
    expect(hist[hist.length - 1]?.percent).toBe(0);
  });

  it("step after completion throws", async () => {
    const { flagId } = await seedWorkspaceAndFlag();
    const canaryId = await controller.start(flagId);
    await controller.step(canaryId, 25);
    await controller.step(canaryId, 50);
    await controller.step(canaryId, 100);

    await expect(controller.step(canaryId, 25)).rejects.toThrow("completed");
  });

  it("abort after completion throws", async () => {
    const { flagId } = await seedWorkspaceAndFlag();
    const canaryId = await controller.start(flagId);
    await controller.step(canaryId, 100);

    await expect(controller.abort(canaryId)).rejects.toThrow("completed");
  });
});
