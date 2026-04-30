import { pgTable, uuid, integer, timestamp, jsonb, text, index } from "drizzle-orm/pg-core";
import { featureFlags } from "./feature_flags.js";

export const canaryRuns = pgTable(
  "canary_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    featureFlagId: uuid("feature_flag_id")
      .notNull()
      .references(() => featureFlags.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    currentPercent: integer("current_percent").notNull().default(0),
    history: jsonb("history").notNull().default([]),
    status: text("status").notNull().default("running"),
  },
  (table) => ({
    flagIdx: index("canary_runs_flag_idx").on(table.featureFlagId, table.startedAt),
  }),
);
