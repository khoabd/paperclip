// Integration tests for PerRepoBrier.
// Gate criteria:
//   Insert decision_log rows for repoId in payload → compute returns Brier within tolerance.

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
} from "../../__tests__/helpers/embedded-postgres.js";
import { PerRepoBrier } from "../per-repo-brier.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping PerRepoBrier integration: ${support.reason ?? "unsupported"}`);
}

desc("PerRepoBrier integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let scorer!: PerRepoBrier;
  let companyId!: string;
  let agentId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("per-repo-brier-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    scorer = new PerRepoBrier(db);
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

  async function seedWorkspaceAndAgent(prefix: string) {
    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: `RepoBrierCo-${prefix}`,
      issuePrefix: `RB${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "repo-brier-agent",
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

  it("computes Brier for repo matching payload.repo_id within tolerance", async () => {
    await seedWorkspaceAndAgent("main");
    const repoId = "repo-alpha";
    const otherRepoId = "repo-beta";
    const now = new Date();

    // Rows for target repo: 20 success@0.8, 20 failure@0.3
    // Expected: (20×(0.8-1)² + 20×(0.3-0)²) / 40 = (20×0.04 + 20×0.09)/40 = (0.8+1.8)/40 = 0.065
    const targetRows = [];
    for (let i = 0; i < 20; i++) {
      targetRows.push({
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
        payload: { repo_id: repoId },
        createdAt: now,
      });
    }
    for (let i = 0; i < 20; i++) {
      targetRows.push({
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
        payload: { repo_id: repoId },
        createdAt: now,
      });
    }

    // Noise row for different repo — should be excluded
    targetRows.push({
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
      outcomeRecordedAt: now,
      brierContribution: String(Math.pow(0.9 - 1, 2)),
      payload: { repo_id: otherRepoId },
      createdAt: now,
    });

    await db.insert(decisionLog).values(targetRows);

    const result = await scorer.computeForRepo(repoId, 30);

    expect(result.n).toBe(40);
    expect(result.brier).toBeCloseTo(0.065, 3);
    expect(result.repoId).toBe(repoId);

    // Calibration row persisted with scope='repo'
    const calRows = await db.select().from(brierCalibration);
    expect(calRows.length).toBe(1);
    expect(calRows[0].scope).toBe("repo");
    expect(calRows[0].scopeId).toBe(repoId);
    expect(Number(calRows[0].brierScore)).toBeCloseTo(0.065, 3);
  });

  it("returns n=0 when no matching rows in window", async () => {
    await seedWorkspaceAndAgent("empty");
    const result = await scorer.computeForRepo("repo-none", 30);
    expect(result.n).toBe(0);
    expect(result.brier).toBe(0);
    expect(result.calibrationId).toBeTruthy();
  });

  it("excludes rows outside the window", async () => {
    await seedWorkspaceAndAgent("window");
    const repoId = "repo-old";
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

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
      payload: { repo_id: repoId },
      createdAt: old,
    });

    const result = await scorer.computeForRepo(repoId, 30);
    expect(result.n).toBe(0);
  });

  it("excludes pending rows (only resolved outcomes counted)", async () => {
    await seedWorkspaceAndAgent("pending");
    const repoId = "repo-pend";
    const now = new Date();

    await db.insert(decisionLog).values({
      companyId,
      agentId,
      kind: "code_change",
      reversibility: "easy",
      blastRadius: "local",
      confidence: "0.8",
      riskScore: "0.1",
      thresholdUsed: "0.65",
      gated: false,
      outcome: "pending",
      payload: { repo_id: repoId },
      createdAt: now,
    });

    const result = await scorer.computeForRepo(repoId, 30);
    expect(result.n).toBe(0);
  });
});
