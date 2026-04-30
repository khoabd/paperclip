// PersonaScenarioStore — Phase 14c §Services.2
//
// Manages Hercules-style NL E2E persona scenarios.
// All external execution is injected via the `runner` callback so that tests
// use deterministic stubs.

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { personaScenarios } from "@paperclipai/db/schema/persona_scenarios";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegisterScenarioInput {
  companyId: string;
  personaSlug: string;
  scenarioText: string;
  expectedOutcome?: string;
  herculesDsl?: Record<string, unknown>;
}

export interface PersonaScenarioRow {
  id: string;
  companyId: string;
  personaSlug: string;
  scenarioText: string;
  expectedOutcome: string | null;
  herculesDsl: Record<string, unknown> | null;
  lastRunTestRunId: string | null;
  status: string;
  createdAt: Date;
}

/** Injected runner — receives the Hercules DSL and returns { passed }. */
export type ScenarioRunner = (
  herculesDsl: Record<string, unknown>,
) => Promise<{ passed: boolean }>;

export interface RunScenarioResult {
  scenarioId: string;
  testRunId: string;
  passed: boolean;
}

// ---------------------------------------------------------------------------
// PersonaScenarioStore
// ---------------------------------------------------------------------------

export class PersonaScenarioStore {
  constructor(private readonly db: Db) {}

  /** Register a new persona scenario. Returns the persisted row. */
  async register(input: RegisterScenarioInput): Promise<PersonaScenarioRow> {
    const [row] = await this.db
      .insert(personaScenarios)
      .values({
        companyId: input.companyId,
        personaSlug: input.personaSlug,
        scenarioText: input.scenarioText,
        expectedOutcome: input.expectedOutcome ?? null,
        herculesDsl: input.herculesDsl ?? null,
        status: "active",
      })
      .returning();

    return this.mapRow(row);
  }

  /**
   * Run a scenario by id using the injected `runner`.
   * Links `last_run_test_run_id` to `testRunId` after execution.
   */
  async runScenario(
    scenarioId: string,
    runner: ScenarioRunner,
    testRunId: string,
  ): Promise<RunScenarioResult> {
    const rows = await this.db
      .select()
      .from(personaScenarios)
      .where(eq(personaScenarios.id, scenarioId));

    if (rows.length === 0) {
      throw new Error(`PersonaScenario not found: ${scenarioId}`);
    }

    const scenario = rows[0];
    const dsl = (scenario.herculesDsl as Record<string, unknown>) ?? {};

    const { passed } = await runner(dsl);

    // Persist last_run_test_run_id
    await this.db
      .update(personaScenarios)
      .set({ lastRunTestRunId: testRunId })
      .where(eq(personaScenarios.id, scenarioId));

    return { scenarioId, testRunId, passed };
  }

  /** Fetch a single scenario by id. */
  async get(id: string): Promise<PersonaScenarioRow | null> {
    const rows = await this.db
      .select()
      .from(personaScenarios)
      .where(eq(personaScenarios.id, id));
    return rows.length > 0 ? this.mapRow(rows[0]) : null;
  }

  /** List all active scenarios for a company. */
  async listActive(companyId: string): Promise<PersonaScenarioRow[]> {
    const rows = await this.db
      .select()
      .from(personaScenarios)
      .where(eq(personaScenarios.companyId, companyId));
    return rows
      .filter((r) => r.status === "active")
      .map((r) => this.mapRow(r));
  }

  // ---------------------------------------------------------------------------

  private mapRow(row: typeof personaScenarios.$inferSelect): PersonaScenarioRow {
    return {
      id: row.id,
      companyId: row.companyId,
      personaSlug: row.personaSlug,
      scenarioText: row.scenarioText,
      expectedOutcome: row.expectedOutcome ?? null,
      herculesDsl: (row.herculesDsl as Record<string, unknown>) ?? null,
      lastRunTestRunId: row.lastRunTestRunId ?? null,
      status: row.status,
      createdAt: row.createdAt,
    };
  }
}
