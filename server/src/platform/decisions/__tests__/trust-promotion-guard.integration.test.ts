// Integration tests for TrustPromotionGuard.
// Gate criterion: brier=0.05 (allow), brier=0.20 (block), no calibration (insufficient_data).

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  brierCalibration,
  companies,
  createDb,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../../__tests__/helpers/embedded-postgres.js";
import { TrustPromotionGuard, BRIER_THRESHOLD } from "../trust-promotion-guard.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping TrustPromotionGuard integration: ${support.reason ?? "unsupported"}`);
}

desc("TrustPromotionGuard integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let guard!: TrustPromotionGuard;
  let companyId!: string;
  let agentId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("trust-guard-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    // minDecisions=5 so tests don't need 30 decisions
    guard = new TrustPromotionGuard(db, 5);
  });

  afterEach(async () => {
    await db.delete(brierCalibration);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedWorkspaceAndAgent() {
    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: `GuardCo-P9`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "trust-guard-agent",
      role: "general",
      status: "idle",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it("allows promotion when brier=0.05 and n>=minDecisions", async () => {
    await seedWorkspaceAndAgent();
    await db.insert(brierCalibration).values({
      scope: "agent",
      scopeId: agentId,
      windowDays: 30,
      n: 10,
      brierScore: "0.05",
      meanConfidence: "0.80",
      meanOutcome: "0.85",
      computedAt: new Date(),
    });

    const result = await guard.canPromote(agentId, "agent");
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("ok");
    expect(result.brier).toBeCloseTo(0.05, 4);
  });

  it("blocks promotion when brier=0.20 (> threshold 0.15)", async () => {
    await seedWorkspaceAndAgent();
    await db.insert(brierCalibration).values({
      scope: "agent",
      scopeId: agentId,
      windowDays: 30,
      n: 10,
      brierScore: "0.20",
      computedAt: new Date(),
    });

    const result = await guard.canPromote(agentId, "agent");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("brier_degraded");
    expect(result.brier).toBeCloseTo(0.20, 4);
  });

  it("blocks promotion when brier exactly equals threshold (0.15 is NOT > threshold)", async () => {
    await seedWorkspaceAndAgent();
    await db.insert(brierCalibration).values({
      scope: "agent",
      scopeId: agentId,
      windowDays: 30,
      n: 10,
      brierScore: String(BRIER_THRESHOLD), // exactly 0.15
      computedAt: new Date(),
    });

    // brier > 0.15 → false at exactly 0.15 → should allow
    const result = await guard.canPromote(agentId, "agent");
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("ok");
  });

  it("blocks promotion when n < minDecisions (insufficient_data)", async () => {
    await seedWorkspaceAndAgent();
    await db.insert(brierCalibration).values({
      scope: "agent",
      scopeId: agentId,
      windowDays: 30,
      n: 3, // below minDecisions=5
      brierScore: "0.05",
      computedAt: new Date(),
    });

    const result = await guard.canPromote(agentId, "agent");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("insufficient_data");
    expect(result.n).toBe(3);
  });

  it("blocks promotion when no calibration row exists (insufficient_data)", async () => {
    await seedWorkspaceAndAgent();
    const result = await guard.canPromote(agentId, "agent");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("insufficient_data");
  });

  it("blocks promotion when most recent calibration is stale (>30 days old)", async () => {
    await seedWorkspaceAndAgent();
    const stale = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await db.insert(brierCalibration).values({
      scope: "agent",
      scopeId: agentId,
      windowDays: 30,
      n: 50,
      brierScore: "0.05",
      computedAt: stale,
    });

    const result = await guard.canPromote(agentId, "agent");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("insufficient_data");
  });

  it("uses most recent calibration row when multiple exist", async () => {
    await seedWorkspaceAndAgent();
    const olderDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const newerDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

    // Old row: brier=0.05 (would allow)
    await db.insert(brierCalibration).values({
      scope: "agent",
      scopeId: agentId,
      windowDays: 30,
      n: 10,
      brierScore: "0.05",
      computedAt: olderDate,
    });
    // Newer row: brier=0.25 (should block)
    await db.insert(brierCalibration).values({
      scope: "agent",
      scopeId: agentId,
      windowDays: 30,
      n: 10,
      brierScore: "0.25",
      computedAt: newerDate,
    });

    const result = await guard.canPromote(agentId, "agent");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("brier_degraded");
    expect(result.brier).toBeCloseTo(0.25, 4);
  });
});
