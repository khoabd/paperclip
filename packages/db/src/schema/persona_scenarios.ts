import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { testRuns } from "./test_runs.js";

export const personaScenarios = pgTable(
  "persona_scenarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    personaSlug: text("persona_slug").notNull(),
    scenarioText: text("scenario_text").notNull(),
    expectedOutcome: text("expected_outcome"),
    /**
     * Hercules DSL payload — arbitrary JSON describing the NL E2E scenario
     * steps, assertions, and persona context.
     */
    herculesDsl: jsonb("hercules_dsl").$type<Record<string, unknown>>(),
    /** FK to test_runs; SET NULL when the run is deleted. */
    lastRunTestRunId: uuid("last_run_test_run_id").references(
      () => testRuns.id,
      { onDelete: "set null" },
    ),
    /** active | archived */
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);
