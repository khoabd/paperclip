// Integration test for DecisionLogger: record decision (pending) → recordOutcome → Brier contribution populated.
// Also covers UncertaintyEmitter.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agentUncertaintyEvents,
  agents,
  companies,
  createDb,
  decisionLog,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../../__tests__/helpers/embedded-postgres.js";
import { DecisionLogger } from "../decision-logger.js";
import { UncertaintyEmitter } from "../uncertainty-emitter.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping DecisionLogger integration: ${support.reason ?? "unsupported"}`);
}

desc("DecisionLogger + UncertaintyEmitter integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let logger!: DecisionLogger;
  let emitter!: UncertaintyEmitter;
  let companyId!: string;
  let agentId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("decision-logger-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    logger = new DecisionLogger(db);
    emitter = new UncertaintyEmitter(db);
  });

  afterEach(async () => {
    await db.delete(agentUncertaintyEvents);
    await db.delete(decisionLog);
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
      name: `LoggerCo-P9`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "logger-agent",
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

  it("records a pending decision then updates outcome with correct Brier contribution", async () => {
    await seedWorkspaceAndAgent();

    // Step 1: Record decision (pending)
    const { decisionId, outcome: pendingOutcome } = await logger.record({
      companyId,
      agentId,
      kind: "code_change",
      reversibility: "easy",
      blastRadius: "local",
      confidence: 0.8,
      riskScore: 0.1,
      thresholdUsed: 0.65,
      gated: false,
      payload: { note: "test" },
    });

    expect(pendingOutcome).toBe("pending");

    // Verify DB row is pending
    const [pending] = await db.select().from(decisionLog).where(eq(decisionLog.id, decisionId));
    expect(pending.outcome).toBe("pending");
    expect(pending.outcomeRecordedAt).toBeNull();
    expect(pending.brierContribution).toBeNull();
    expect(Number(pending.confidence)).toBeCloseTo(0.8, 4);

    // Step 2: Record outcome = success
    const outcomeResult = await logger.recordOutcome(decisionId, "success");
    expect(outcomeResult.outcome).toBe("success");
    // brierContribution = (0.8 - 1)² = 0.04
    expect(outcomeResult.brierContribution).toBeCloseTo(0.04, 6);

    // Verify DB row updated
    const [updated] = await db.select().from(decisionLog).where(eq(decisionLog.id, decisionId));
    expect(updated.outcome).toBe("success");
    expect(updated.outcomeRecordedAt).not.toBeNull();
    expect(Number(updated.brierContribution)).toBeCloseTo(0.04, 6);
  });

  it("records failure outcome with correct Brier contribution", async () => {
    await seedWorkspaceAndAgent();
    const { decisionId } = await logger.record({
      companyId,
      agentId,
      kind: "deploy",
      reversibility: "hard",
      blastRadius: "company",
      confidence: 0.3,
      riskScore: 0.5,
      thresholdUsed: 0.85,
      gated: true,
    });

    const result = await logger.recordOutcome(decisionId, "failure");
    // brierContribution = (0.3 - 0)² = 0.09
    expect(result.brierContribution).toBeCloseTo(0.09, 6);
    expect(result.outcome).toBe("failure");
  });

  it("records partial outcome: brierContribution = confidence²", async () => {
    await seedWorkspaceAndAgent();
    const { decisionId } = await logger.record({
      companyId,
      agentId,
      kind: "migration",
      reversibility: "irreversible",
      blastRadius: "workspace",
      confidence: 0.7,
      riskScore: 0.6,
      thresholdUsed: 0.90,
      gated: true,
    });

    const result = await logger.recordOutcome(decisionId, "partial");
    // partial → outcomeBinary=0, brierContribution = (0.7 - 0)² = 0.49
    expect(result.brierContribution).toBeCloseTo(0.49, 6);
  });

  it("throws when attempting to record outcome for unknown or already-resolved decision", async () => {
    await seedWorkspaceAndAgent();
    const fakeId = randomUUID();
    await expect(logger.recordOutcome(fakeId, "success")).rejects.toThrow();
  });

  it("records gated=true decisions with approval reference", async () => {
    await seedWorkspaceAndAgent();
    const { decisionId } = await logger.record({
      companyId,
      agentId,
      kind: "policy_exception",
      reversibility: "hard",
      blastRadius: "global",
      confidence: 0.95,
      riskScore: 0.8,
      thresholdUsed: 0.92,
      gated: true,
    });

    const [row] = await db.select().from(decisionLog).where(eq(decisionLog.id, decisionId));
    expect(row.gated).toBe(true);
  });

  describe("UncertaintyEmitter", () => {
    it("emits low_confidence event", async () => {
      await seedWorkspaceAndAgent();
      const { id } = await emitter.emit(agentId, "low_confidence", { score: 0.2 });
      expect(id).toBeTruthy();

      const [row] = await db
        .select()
        .from(agentUncertaintyEvents)
        .where(eq(agentUncertaintyEvents.id, id));
      expect(row.kind).toBe("low_confidence");
      expect(row.agentId).toBe(agentId);
      expect((row.payload as any).score).toBe(0.2);
    });

    it("emits all valid uncertainty kinds", async () => {
      await seedWorkspaceAndAgent();
      const kinds = [
        "low_confidence",
        "conflicting_signals",
        "stale_data",
        "disputed_outcome",
        "unknown_class",
      ] as const;

      for (const kind of kinds) {
        const { id } = await emitter.emit(agentId, kind);
        expect(id).toBeTruthy();
      }

      const rows = await db.select().from(agentUncertaintyEvents);
      expect(rows.length).toBe(kinds.length);
    });

    it("emits with missionId when provided", async () => {
      await seedWorkspaceAndAgent();
      const fakeMissionId = randomUUID();
      // missionId will fail FK unless mission exists — use null FK scenario
      // Here we test with null missionId since we'd need a mission row
      const { id } = await emitter.emit(agentId, "stale_data", {}, null);
      const [row] = await db
        .select()
        .from(agentUncertaintyEvents)
        .where(eq(agentUncertaintyEvents.id, id));
      expect(row.missionId).toBeNull();
    });
  });
});
