import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { testRuns } from "./test_runs.js";

export const crossDeviceResults = pgTable(
  "cross_device_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    testRunId: uuid("test_run_id")
      .notNull()
      .references(() => testRuns.id, { onDelete: "cascade" }),
    /** mobile | tablet | desktop | wide_desktop */
    deviceClass: text("device_class").notNull(),
    viewport: text("viewport").notNull(),
    browser: text("browser").notNull(),
    screenshotUri: text("screenshot_uri"),
    /** passed | failed | errored */
    status: text("status").notNull().default("passed"),
    diffPixelCount: integer("diff_pixel_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runClassIdx: index("cross_device_results_run_class_idx").on(table.testRunId, table.deviceClass),
  }),
);
