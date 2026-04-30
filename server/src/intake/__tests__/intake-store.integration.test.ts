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
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { IntakeStore } from "../intake-store.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping IntakeStore integration tests: ${embeddedPostgresSupport.reason ?? "unsupported"}`,
  );
}

describeEmbeddedPostgres("IntakeStore", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let store!: IntakeStore;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("intake-store-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    store = new IntakeStore(db);
  });

  afterEach(async () => {
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
      name: "IntakeCo",
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

  it("creates an intake with an initial triaged workflow state", async () => {
    const wsId = await seedWorkspace();
    const intakeId = await store.create({
      companyId: wsId,
      type: "feature_request",
      rawText: "Add dark mode",
      title: "Dark mode",
      submitterUserId: "user-1",
    });
    const row = (await db.select().from(intakeItems).where(eq(intakeItems.id, intakeId)))[0]!;
    expect(row.type).toBe("feature_request");
    expect(row.state).toBe("triaged");

    const states = await store.listWorkflowStates(intakeId);
    expect(states).toHaveLength(1);
    expect(states[0]!.state).toBe("triaged");
    expect(states[0]!.leftAt).toBeNull();
  });

  it("appendWorkflowState closes the previous state and updates the intake", async () => {
    const wsId = await seedWorkspace();
    const intakeId = await store.create({
      companyId: wsId,
      type: "feature_request",
      rawText: "Add SAML",
      title: "SAML",
    });
    await store.appendWorkflowState({ intakeId, state: "spec_drafted" });
    const states = await store.listWorkflowStates(intakeId);
    expect(states).toHaveLength(2);
    expect(states[0]!.state).toBe("triaged");
    expect(states[0]!.leftAt).not.toBeNull();
    expect(states[1]!.state).toBe("spec_drafted");
    expect(states[1]!.leftAt).toBeNull();
    const row = (await db.select().from(intakeItems).where(eq(intakeItems.id, intakeId)))[0]!;
    expect(row.state).toBe("spec_drafted");
  });

  it("listByCompany filters by state and excludes closed intakes", async () => {
    const wsId = await seedWorkspace();
    const a = await store.create({
      companyId: wsId,
      type: "feature_request",
      rawText: "A",
      title: "A",
    });
    const b = await store.create({
      companyId: wsId,
      type: "bug_report",
      rawText: "B",
      title: "B",
    });
    await store.appendWorkflowState({ intakeId: b, state: "spec_drafted" });
    const triaged = await store.listByCompany(wsId, { state: "triaged" });
    expect(triaged.map((r) => r.id)).toContain(a);
    expect(triaged.map((r) => r.id)).not.toContain(b);

    await store.close(a, "silent");
    const all = await store.listByCompany(wsId);
    expect(all.map((r) => r.id)).not.toContain(a);
    expect(all.map((r) => r.id)).toContain(b);
  });

  it("solutions: addSolution + selectSolution flips a single row to selected=true", async () => {
    const wsId = await seedWorkspace();
    const intakeId = await store.create({
      companyId: wsId,
      type: "feature_request",
      rawText: "X",
      title: "X",
    });
    await store.addSolution({
      intakeId,
      candidateIdx: 0,
      title: "MVP",
      effortDays: 3,
      etaP50Days: 3,
      etaP90Days: 5,
      costUsd: 600,
    });
    await store.addSolution({
      intakeId,
      candidateIdx: 1,
      title: "Polished",
      effortDays: 7,
      etaP50Days: 7,
      etaP90Days: 12,
      costUsd: 1400,
    });
    await store.selectSolution(intakeId, 1, "want telemetry");
    const candidates = await store.listSolutions(intakeId);
    expect(candidates).toHaveLength(2);
    expect(candidates.find((c) => c.candidateIdx === 0)!.selected).toBe(false);
    expect(candidates.find((c) => c.candidateIdx === 1)!.selected).toBe(true);
    expect(candidates.find((c) => c.candidateIdx === 1)!.selectionReason).toBe("want telemetry");
  });

  it("addTimelineEstimate persists with level + source", async () => {
    const wsId = await seedWorkspace();
    const intakeId = await store.create({
      companyId: wsId,
      type: "feature_request",
      rawText: "T",
      title: "T",
    });
    await store.addTimelineEstimate({
      intakeId,
      level: "L1",
      p50Days: 3,
      p90Days: 8,
      source: "bracket",
      rationale: "test",
    });
    const rows = await store.listTimelineEstimates(intakeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.level).toBe("L1");
    expect(Number(rows[0]!.p50Days)).toBe(3);
    expect(rows[0]!.source).toBe("bracket");
  });

  it("preallocateOutcomeTracker is idempotent on duplicate insert", async () => {
    const wsId = await seedWorkspace();
    const intakeId = await store.create({
      companyId: wsId,
      type: "feature_request",
      rawText: "O",
      title: "O",
    });
    await store.preallocateOutcomeTracker(intakeId, 5, 1000);
    await store.preallocateOutcomeTracker(intakeId, 99, 9999);
    const rows = await db
      .select()
      .from(intakeOutcomeTracker)
      .where(eq(intakeOutcomeTracker.intakeId, intakeId));
    expect(rows).toHaveLength(1);
    // First write wins per onConflictDoNothing.
    expect(Number(rows[0]!.predictedEtaP50Days)).toBe(5);
  });

  it("close marks intake closed and writes acceptance status when tracker exists", async () => {
    const wsId = await seedWorkspace();
    const intakeId = await store.create({
      companyId: wsId,
      type: "feature_request",
      rawText: "C",
      title: "C",
    });
    await store.preallocateOutcomeTracker(intakeId, 3, 600);
    await store.close(intakeId, "accepted");
    const row = (await db.select().from(intakeItems).where(eq(intakeItems.id, intakeId)))[0]!;
    expect(row.closedAt).not.toBeNull();
    expect(row.state).toBe("closed");
    const tracker = (
      await db
        .select()
        .from(intakeOutcomeTracker)
        .where(eq(intakeOutcomeTracker.intakeId, intakeId))
    )[0]!;
    expect(tracker.acceptanceStatus).toBe("accepted");
    expect(tracker.measuredAt).not.toBeNull();
  });
});
