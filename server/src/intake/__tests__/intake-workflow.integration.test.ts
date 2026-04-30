import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  companies,
  createDb,
  intakeItems,
  intakeOutcomeTracker,
  intakeSolutions,
  intakeTimelineEstimates,
  intakeWorkflowStates,
  missions,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { IntakeStore } from "../intake-store.js";
import { IntakeTriageAgent } from "../intake-triage-agent.js";
import { IntakeMissionBridge } from "../intake-mission-bridge.js";
import { IntakeWorkflowRunner } from "../intake-workflow.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping IntakeWorkflowRunner integration tests: ${embeddedPostgresSupport.reason ?? "unsupported"}`,
  );
}

describeEmbeddedPostgres("IntakeWorkflowRunner — feature_request happy path (Mile-A)", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let store!: IntakeStore;
  let runner!: IntakeWorkflowRunner;
  let triage!: IntakeTriageAgent;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("intake-workflow-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    store = new IntakeStore(db);
    triage = new IntakeTriageAgent(store);
    runner = new IntakeWorkflowRunner(store, new IntakeMissionBridge(db, store));
  });

  afterEach(async () => {
    await db.delete(missions);
    await db.delete(intakeOutcomeTracker);
    await db.delete(intakeTimelineEstimates);
    await db.delete(intakeSolutions);
    await db.delete(intakeWorkflowStates);
    await db.delete(intakeItems);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedWorkspace(): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name: "WfCo",
      status: "active",
      autonomyLevel: "sandbox",
      wfqWeight: 100,
      costBudgetUsdPerWeek: "100.0000",
      ragNamespace: `ns-${id}`,
      vaultPath: `/vault/${id}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("triage → spec_drafted → candidates_ready → approved_solution → mission spawn", async () => {
    const wsId = await seedWorkspace();
    const triaged = await triage.triage({
      companyId: wsId,
      rawText: "Can we add support for exporting reports as PDF?",
      title: "PDF export",
      customerDemandSignals: 30,
    });
    expect(triaged.type).toBe("feature_request");

    const a1 = await runner.advance(triaged.intakeId);
    expect(a1.fromState).toBe("triaged");
    expect(a1.toState).toBe("spec_drafted");
    const intakeAfterDraft = await store.getById(triaged.intakeId);
    expect(intakeAfterDraft!.spec).toContain("PDF export");

    const a2 = await runner.advance(triaged.intakeId);
    expect(a2.fromState).toBe("spec_drafted");
    expect(a2.toState).toBe("candidates_ready");
    const candidates = await store.listSolutions(triaged.intakeId);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.title).toBeDefined();
    expect(Number(candidates[0]!.etaP50Days)).toBeGreaterThan(0);

    const result = await runner.selectCandidate({
      intakeId: triaged.intakeId,
      candidateIdx: 1,
      reason: "want polish + telemetry",
      actorUserId: "u-1",
    });
    expect(result.missionId).toBeDefined();

    const mission = (
      await db.select().from(missions).where(eq(missions.id, result.missionId)).limit(1)
    )[0]!;
    expect(mission.companyId).toBe(wsId);
    expect(mission.status).toBe("intake");
    expect(mission.goal).toContain("PDF export");

    const intake = await store.getById(triaged.intakeId);
    expect(intake!.missionId).toBe(result.missionId);
    expect(intake!.state).toBe("in_progress");

    const tracker = (
      await db
        .select()
        .from(intakeOutcomeTracker)
        .where(eq(intakeOutcomeTracker.intakeId, triaged.intakeId))
    )[0]!;
    expect(tracker.predictedEtaP50Days).not.toBeNull();
    expect(tracker.predictedCostUsd).not.toBeNull();

    const states = await store.listWorkflowStates(triaged.intakeId);
    const sequence = states.map((s) => s.state);
    expect(sequence).toEqual([
      "triaged",
      "spec_drafted",
      "candidates_ready",
      "approved_solution",
      "in_progress",
    ]);
  });

  it("non-feature_request types are parked with a deferred-phase note", async () => {
    const wsId = await seedWorkspace();
    const triaged = await triage.triage({
      companyId: wsId,
      rawText: "How does the budget calculator work?",
    });
    expect(triaged.type).toBe("question");
    const r = await runner.advance(triaged.intakeId);
    expect(r.toState).toBe("parked");
    const intake = await store.getById(triaged.intakeId);
    expect(intake!.state).toBe("parked");
  });

  it("selectCandidate refuses when intake is not in candidates_ready", async () => {
    const wsId = await seedWorkspace();
    const triaged = await triage.triage({
      companyId: wsId,
      rawText: "Add SAML SSO",
      title: "SAML",
      customerDemandSignals: 60,
    });
    await expect(
      runner.selectCandidate({ intakeId: triaged.intakeId, candidateIdx: 0 }),
    ).rejects.toThrow(/cannot select candidate/);
  });
});
