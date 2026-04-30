import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
  intakeItems,
  intakeTimelineEstimates,
  intakeWorkflowStates,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { IntakeStore } from "../intake-store.js";
import { IntakeTriageAgent } from "../intake-triage-agent.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping IntakeTriageAgent integration tests: ${embeddedPostgresSupport.reason ?? "unsupported"}`,
  );
}

describeEmbeddedPostgres("IntakeTriageAgent", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let agent!: IntakeTriageAgent;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("intake-triage-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    agent = new IntakeTriageAgent(new IntakeStore(db));
  });

  afterEach(async () => {
    await db.delete(intakeTimelineEstimates);
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
      name: "TriageCo",
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

  it("classifies feature_request, persists L1, sets priority", async () => {
    const wsId = await seedWorkspace();
    const r = await agent.triage({
      companyId: wsId,
      rawText: "Can we add support for SAML SSO and SCIM provisioning?",
      title: "SAML SSO",
      submitterUserId: "u-1",
      customerDemandSignals: 60,
    });
    expect(r.type).toBe("feature_request");
    expect(["P0", "P1", "P2", "P3"]).toContain(r.priority);
    expect(r.l1).not.toBeNull();
    expect(r.classifierConfidence).toBeGreaterThan(0);

    const intake = await new IntakeStore(db).getById(r.intakeId);
    expect(intake!.priority).toBe(r.priority);
    expect(intake!.classifiedTypeConf).not.toBeNull();
    expect(Number(intake!.classifiedTypeConf)).toBeCloseTo(r.classifierConfidence, 4);

    const states = await new IntakeStore(db).listWorkflowStates(r.intakeId);
    expect(states).toHaveLength(1);
    expect(states[0]!.state).toBe("triaged");

    const timelines = await new IntakeStore(db).listTimelineEstimates(r.intakeId);
    expect(timelines).toHaveLength(1);
    expect(timelines[0]!.level).toBe("L1");
  });

  it("classifies bug_report on repro phrasing and persists priority", async () => {
    const wsId = await seedWorkspace();
    const r = await agent.triage({
      companyId: wsId,
      rawText: "Steps to reproduce: open settings, click save, stack trace appears.",
      title: "Save crashes",
      severity: "crash",
      affectedUsersEstimated: 800,
    });
    expect(r.type).toBe("bug_report");
    expect(["P1", "P2"]).toContain(r.priority);
    expect(r.l1).not.toBeNull();
  });

  it("emits no L1 timeline for passive feedback types", async () => {
    const wsId = await seedWorkspace();
    const r = await agent.triage({
      companyId: wsId,
      rawText: "Loving the new release feel",
      linkedReleaseTag: "v3.4.0",
    });
    expect(r.type).toBe("feedback_release");
    expect(r.l1).toBeNull();
    const tl = await new IntakeStore(db).listTimelineEstimates(r.intakeId);
    expect(tl).toHaveLength(0);
  });

  it("flags needsHumanType when heuristic confidence < 0.7", async () => {
    const wsId = await seedWorkspace();
    const r = await agent.triage({
      companyId: wsId,
      rawText: "hmm",
      title: "vague",
    });
    expect(r.needsHumanType).toBe(true);
  });
});
