import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  approvalPatternDecisions,
  approvals,
  capabilityRegistry,
  companies,
  createDb,
  workspaceCapabilityOverrides,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../../__tests__/helpers/embedded-postgres.js";
import { ApprovalRouter } from "../approval-router.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping ApprovalRouter integration: ${support.reason ?? "unsupported"}`);
}

desc("ApprovalRouter integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let router!: ApprovalRouter;
  let workspaceId!: string;
  let capabilityId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("approval-router-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    router = new ApprovalRouter(db);
  });

  afterEach(async () => {
    await db.delete(approvalPatternDecisions);
    await db.delete(approvals);
    await db.delete(workspaceCapabilityOverrides);
    await db.delete(capabilityRegistry);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seed(opts: { autonomy?: string; capabilityDefault?: string } = {}) {
    workspaceId = randomUUID();
    await db.insert(companies).values({
      id: workspaceId,
      name: "Acme",
      status: "active",
      autonomyLevel: opts.autonomy ?? "supervised",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    capabilityId = randomUUID();
    await db.insert(capabilityRegistry).values({
      id: capabilityId,
      name: "code.write",
      defaultMode: opts.capabilityDefault ?? "supervised",
      riskTier: "medium",
    });
  }

  function codeChange(overrides: Record<string, unknown> = {}) {
    return {
      proposal_pattern: "code_change",
      summary: "Touch a file",
      rationale: "Tested",
      repo: "paperclip",
      branch: "ai/test",
      diff: "@@ -1 +1 @@",
      filesChanged: ["a.ts"],
      ...overrides,
    };
  }

  it("auto-approves and writes telemetry only (no approvals row) when supervised + good confidence/risk", async () => {
    await seed({ autonomy: "supervised", capabilityDefault: "supervised" });
    const result = await router.route({
      workspaceId,
      type: "code_change",
      payload: codeChange(),
      capabilityKey: "code.write",
      confidence: 0.95,
      riskScore: 0.1,
    });
    expect(result.decision.decision).toBe("auto_approve");
    expect(result.approvalId).toBeNull();
    const approvalRows = await db.select().from(approvals).where(eq(approvals.companyId, workspaceId));
    expect(approvalRows).toHaveLength(0);
    const telemetry = await db
      .select()
      .from(approvalPatternDecisions)
      .where(eq(approvalPatternDecisions.companyId, workspaceId));
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]!.decision).toBe("auto_approve");
    expect(telemetry[0]!.proposalPattern).toBe("code_change");
  });

  it("creates an approvals row + telemetry when sandbox forces a gate", async () => {
    await seed({ autonomy: "sandbox", capabilityDefault: "autonomous" });
    const result = await router.route({
      workspaceId,
      type: "code_change",
      payload: codeChange(),
      capabilityKey: "code.write",
      confidence: 0.99,
      riskScore: 0.0,
    });
    expect(result.decision.decision).toBe("gate");
    expect(result.approvalId).not.toBeNull();
    const rows = await db.select().from(approvals).where(eq(approvals.id, result.approvalId!));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.proposalPattern).toBe("code_change");
    expect(rows[0]!.priority).toBe("medium");
    expect(rows[0]!.capabilityId).toBe(capabilityId);
    expect(Number(rows[0]!.confidence)).toBeCloseTo(0.99, 4);
    const telemetry = await db
      .select()
      .from(approvalPatternDecisions)
      .where(eq(approvalPatternDecisions.companyId, workspaceId));
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]!.decision).toBe("gate");
    expect(telemetry[0]!.capabilityMode).toBe("autonomous");
  });

  it("workspace capability override beats capability default mode", async () => {
    await seed({ autonomy: "trusted", capabilityDefault: "trusted" });
    await db.insert(workspaceCapabilityOverrides).values({
      companyId: workspaceId,
      capabilityId,
      mode: "supervised",
      overrideReason: "tighten until brier improves",
    });
    const result = await router.route({
      workspaceId,
      type: "code_change",
      payload: codeChange(),
      capabilityKey: "code.write",
      confidence: 0.7, // would auto in trusted; supervised demands ≥0.8
      riskScore: 0.1,
    });
    expect(result.decision.effectiveMode).toBe("supervised");
    expect(result.decision.decision).toBe("gate");
    const telemetry = await db
      .select()
      .from(approvalPatternDecisions)
      .where(eq(approvalPatternDecisions.companyId, workspaceId));
    expect(telemetry[0]!.capabilityMode).toBe("supervised");
  });

  it("rejects malformed payload before any DB write", async () => {
    await seed();
    await expect(
      router.route({
        workspaceId,
        type: "code_change",
        payload: { proposal_pattern: "code_change", summary: "x", rationale: "x" }, // missing repo/branch/diff
        capabilityKey: "code.write",
        confidence: 0.9,
        riskScore: 0.1,
      }),
    ).rejects.toThrow();
    const tel = await db
      .select()
      .from(approvalPatternDecisions)
      .where(eq(approvalPatternDecisions.companyId, workspaceId));
    expect(tel).toHaveLength(0);
  });

  it("policy_exception always gates regardless of mode", async () => {
    await seed({ autonomy: "autonomous", capabilityDefault: "autonomous" });
    const result = await router.route({
      workspaceId,
      type: "policy_exception",
      payload: {
        proposal_pattern: "policy_exception",
        summary: "1h waiver",
        rationale: "ops escalation",
        capabilityKey: "code.write",
        durationMinutes: 60,
      },
      capabilityKey: "code.write",
      confidence: 0.95,
      riskScore: 0.05,
    });
    expect(result.decision.decision).toBe("gate");
    const rows = await db.select().from(approvals).where(eq(approvals.id, result.approvalId!));
    expect(rows[0]!.priority).toBe("high");
  });

  it("uses provided timeoutMinutes to set timeout_at", async () => {
    await seed({ autonomy: "sandbox", capabilityDefault: "autonomous" });
    const before = Date.now();
    const result = await router.route({
      workspaceId,
      type: "code_change",
      payload: codeChange(),
      capabilityKey: "code.write",
      confidence: 0.9,
      riskScore: 0.1,
      timeoutMinutes: 15,
    });
    const row = (
      await db.select().from(approvals).where(eq(approvals.id, result.approvalId!)).limit(1)
    )[0];
    expect(row?.timeoutAt).not.toBeNull();
    const ms = row!.timeoutAt!.getTime() - before;
    expect(ms).toBeGreaterThan(14 * 60_000);
    expect(ms).toBeLessThan(16 * 60_000);
  });
});
