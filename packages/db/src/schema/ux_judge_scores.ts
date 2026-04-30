import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
} from "drizzle-orm/pg-core";
import { testRuns } from "./test_runs.js";

export const uxJudgeScores = pgTable(
  "ux_judge_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    testRunId: uuid("test_run_id")
      .notNull()
      .references(() => testRuns.id, { onDelete: "cascade" }),
    /**
     * clarity | hierarchy | consistency | affordance |
     * feedback | accessibility | delight
     */
    dimension: text("dimension").notNull(),
    score: numeric("score", { precision: 5, scale: 2 }).notNull(),
    reasoning: text("reasoning"),
    screenshotUri: text("screenshot_uri"),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
