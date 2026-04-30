// Integration tests for PersonaScenarioStore.
// Gate criteria:
//   • register → row stored with status=active.
//   • runScenario with mock runner returning passed=true → last_run_test_run_id linked.
//   • runScenario on nonexistent id → throws.
//   • listActive returns only active scenarios.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { PersonaScenarioStore } from "../persona-scenario-store.js";
import { TestRunStore } from "../../testing-foundation/test-run-store.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping PersonaScenarioStore integration: ${support.reason ?? "unsupported"}`);
}

desc("PersonaScenarioStore integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let store!: PersonaScenarioStore;
  let runStore!: TestRunStore;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("persona-store-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    store = new PersonaScenarioStore(db);
    runStore = new TestRunStore(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM persona_scenarios`);
    await db.execute(sql`DELETE FROM test_runs`);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedCompany(prefix: string): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name: `PSCo-${prefix}`,
      issuePrefix: `PS${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("register creates an active scenario with correct fields", async () => {
    const companyId = await seedCompany("reg");

    const scenario = await store.register({
      companyId,
      personaSlug: "power-user",
      scenarioText: "As a power user, I want to bulk-approve issues",
      expectedOutcome: "All selected issues transition to approved",
      herculesDsl: { steps: [{ action: "click", selector: "#bulk-approve" }] },
    });

    expect(scenario.id).toBeTruthy();
    expect(scenario.companyId).toBe(companyId);
    expect(scenario.personaSlug).toBe("power-user");
    expect(scenario.status).toBe("active");
    expect(scenario.lastRunTestRunId).toBeNull();
    expect(scenario.herculesDsl).toEqual({
      steps: [{ action: "click", selector: "#bulk-approve" }],
    });
  });

  it("runScenario with passed=true runner links last_run_test_run_id", async () => {
    const companyId = await seedCompany("run");

    const scenario = await store.register({
      companyId,
      personaSlug: "admin",
      scenarioText: "Admin creates a new workspace",
      herculesDsl: { steps: [] },
    });

    const run = await runStore.create({
      companyId,
      dimension: "persona_e2e",
      prRef: `pr-ps-${randomUUID().slice(0, 8)}`,
    });

    const mockRunner = async (_dsl: Record<string, unknown>) => ({ passed: true });

    const result = await store.runScenario(scenario.id, mockRunner, run.id);

    expect(result.passed).toBe(true);
    expect(result.testRunId).toBe(run.id);
    expect(result.scenarioId).toBe(scenario.id);

    // Verify persistence
    const fetched = await store.get(scenario.id);
    expect(fetched?.lastRunTestRunId).toBe(run.id);
  });

  it("runScenario on nonexistent id throws", async () => {
    const fakeId = randomUUID();
    await expect(
      store.runScenario(fakeId, async () => ({ passed: true }), randomUUID()),
    ).rejects.toThrow(`PersonaScenario not found: ${fakeId}`);
  });

  it("listActive returns only active scenarios for the company", async () => {
    const companyId = await seedCompany("list");

    await store.register({
      companyId,
      personaSlug: "viewer",
      scenarioText: "Viewer reads a report",
    });
    await store.register({
      companyId,
      personaSlug: "editor",
      scenarioText: "Editor updates an issue",
    });

    const list = await store.listActive(companyId);
    expect(list).toHaveLength(2);
    expect(list.every((s) => s.status === "active")).toBe(true);
  });
});
