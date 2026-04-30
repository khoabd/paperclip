import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { testRuns } from "./test_runs.js";

export const fuzzRunSummaries = pgTable(
  "fuzz_run_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    testRunId: uuid("test_run_id")
      .notNull()
      .references(() => testRuns.id, { onDelete: "cascade" }),
    target: text("target").notNull(),
    totalRuns: integer("total_runs").notNull(),
    failures: integer("failures").notNull(),
    shrunkFailures: integer("shrunk_failures").notNull(),
    seed: text("seed"),
    summary: jsonb("summary")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);
