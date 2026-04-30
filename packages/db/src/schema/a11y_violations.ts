import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { testRuns } from "./test_runs.js";

export const a11yViolations = pgTable(
  "a11y_violations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    testRunId: uuid("test_run_id")
      .notNull()
      .references(() => testRuns.id, { onDelete: "cascade" }),
    /** Rule identifier (e.g. axe-core rule id) */
    ruleId: text("rule_id").notNull(),
    /** minor | moderate | serious | critical */
    impact: text("impact").notNull(),
    targetSelector: text("target_selector").notNull(),
    htmlSnippet: text("html_snippet"),
    helpUrl: text("help_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runImpactIdx: index("a11y_violations_run_impact_idx").on(table.testRunId, table.impact),
  }),
);
