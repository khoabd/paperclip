import {
  pgTable,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { testRuns } from "./test_runs.js";

export const i18nViolations = pgTable(
  "i18n_violations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    testRunId: uuid("test_run_id")
      .notNull()
      .references(() => testRuns.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    /** untranslated | truncation | date_format | number_format | rtl_overlap | pluralization */
    kind: text("kind").notNull(),
    targetSelector: text("target_selector").notNull(),
    expectedText: text("expected_text"),
    actualText: text("actual_text"),
    /** minor | moderate | serious | critical */
    severity: text("severity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
