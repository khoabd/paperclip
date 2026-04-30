// Integration test for BrierScorer.
// Gate criterion: insert 100 decision_log rows for one agent with mixed outcomes,
// run computeForAgent, assert brier ≈ hand-computed expectation (±0.001),
// assert brier_calibration row persisted.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  brierCalibration,
  companies,
  createDb,
  decisionClassLookup,
  decisionLog,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../../__tests__/helpers/embedded-postgres.js";
import { BrierScorer } from "../brier-scorer.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping BrierScorer integration: ${support.reason ?? "unsupported"}`);
}

desc("BrierScorer integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let scorer!: BrierScorer;
  let companyId!: string;
  let agentId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("brier-scorer-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    scorer = new BrierScorer(db);
  });

  afterEach(async () => {
    await db.delete(brierCalibration);
    await db.delete(decisionLog);
    await db.delete(decisionClassLookup);
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
      name: `BrierCo-P9`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "brier-test-agent",
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

  it("computes Brier score matching hand-computed expectation within 0.001", async () => {
    await seedWorkspaceAndAgent();

    // Build 100 rows: alternating success/failure with fixed confidences
    // Successes (50): confidence=0.8, outcome=success → brier_contrib = (0.8-1)² = 0.04
    // Failures  (50): confidence=0.3, outcome=failure → brier_contrib = (0.3-0)² = 0.09
    // Expected Brier = (50×0.04 + 50×0.09) / 100 = (2.0 + 4.5) / 100 = 0.065
    const handComputedBrier = 0.065;

    const now = new Date();
    const rows = [];
    for (let i = 0; i < 50; i++) {
      rows.push({
        companyId,
        agentId,
        kind: "code_change",
        reversibility: "easy",
        blastRadius: "local",
        confidence: "0.8",
        riskScore: "0.1",
        thresholdUsed: "0.65",
        gated: false,
        outcome: "success",
        outcomeRecordedAt: now,
        brierContribution: String(Math.pow(0.8 - 1, 2)),
        createdAt: now,
      });
    }
    for (let i = 0; i < 50; i++) {
      rows.push({
        companyId,
        agentId,
        kind: "code_change",
        reversibility: "easy",
        blastRadius: "local",
        confidence: "0.3",
        riskScore: "0.1",
        thresholdUsed: "0.65",
        gated: false,
        outcome: "failure",
        outcomeRecordedAt: now,
        brierContribution: String(Math.pow(0.3 - 0, 2)),
        createdAt: now,
      });
    }

    await db.insert(decisionLog).values(rows);

    const result = await scorer.computeForAgent(agentId, 30);

    expect(result.n).toBe(100);
    expect(result.brier).toBeCloseTo(handComputedBrier, 3);
    expect(result.meanConfidence).toBeCloseTo(0.55, 3); // (50×0.8 + 50×0.3)/100
    expect(result.meanOutcome).toBeCloseTo(0.5, 3);     // 50 success / 100

    // Verify brier_calibration row was persisted
    const calRows = await db.select().from(brierCalibration);
    expect(calRows.length).toBe(1);
    expect(calRows[0].scope).toBe("agent");
    expect(calRows[0].scopeId).toBe(agentId);
    expect(calRows[0].windowDays).toBe(30);
    expect(calRows[0].n).toBe(100);
    expect(Number(calRows[0].brierScore)).toBeCloseTo(handComputedBrier, 3);
  });

  it("returns n=0 and persists calibration row when no resolved decisions exist", async () => {
    await seedWorkspaceAndAgent();
    // Insert a pending row — should NOT be counted
    await db.insert(decisionLog).values({
      companyId,
      agentId,
      kind: "code_change",
      reversibility: "easy",
      blastRadius: "local",
      confidence: "0.7",
      riskScore: "0.2",
      thresholdUsed: "0.65",
      gated: false,
      outcome: "pending",
    });

    const result = await scorer.computeForAgent(agentId, 30);
    expect(result.n).toBe(0);

    const calRows = await db.select().from(brierCalibration);
    expect(calRows.length).toBe(1);
    expect(calRows[0].n).toBe(0);
  });

  it("excludes decisions older than windowDays", async () => {
    await seedWorkspaceAndAgent();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
    await db.insert(decisionLog).values({
      companyId,
      agentId,
      kind: "code_change",
      reversibility: "easy",
      blastRadius: "local",
      confidence: "0.9",
      riskScore: "0.1",
      thresholdUsed: "0.65",
      gated: false,
      outcome: "success",
      outcomeRecordedAt: old,
      createdAt: old,
    });

    const result = await scorer.computeForAgent(agentId, 30);
    expect(result.n).toBe(0);
  });
});
