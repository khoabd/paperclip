import {
  pgTable,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { testRuns } from "./test_runs.js";

export const mobileTestRuns = pgTable(
  "mobile_test_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    testRunId: uuid("test_run_id")
      .notNull()
      .references(() => testRuns.id, { onDelete: "cascade" }),
    /** ios | android */
    platform: text("platform").notNull(),
    deviceModel: text("device_model").notNull(),
    osVersion: text("os_version").notNull(),
    screenshotUri: text("screenshot_uri"),
    videoUri: text("video_uri"),
    /** passed | failed | errored */
    status: text("status").notNull().default("passed"),
    appiumSessionId: text("appium_session_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
