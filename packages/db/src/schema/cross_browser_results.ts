import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { testRuns } from "./test_runs.js";
import { visualBaselines } from "./visual_baselines.js";

export const crossBrowserResults = pgTable(
  "cross_browser_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    testRunId: uuid("test_run_id")
      .notNull()
      .references(() => testRuns.id, { onDelete: "cascade" }),
    browser: text("browser").notNull(),
    viewport: text("viewport").notNull(),
    screenshotUri: text("screenshot_uri"),
    diffPixelCount: integer("diff_pixel_count"),
    baselineId: uuid("baseline_id").references(() => visualBaselines.id, { onDelete: "set null" }),
    /** passed | failed | new_baseline_needed */
    status: text("status").notNull().default("passed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
