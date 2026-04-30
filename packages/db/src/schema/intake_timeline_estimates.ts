import { pgTable, uuid, text, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { intakeItems } from "./intake_items.js";

export const intakeTimelineEstimates = pgTable(
  "intake_timeline_estimates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    intakeId: uuid("intake_id")
      .notNull()
      .references(() => intakeItems.id, { onDelete: "cascade" }),
    level: text("level").notNull(),
    p50Days: numeric("p50_days", { precision: 8, scale: 2 }),
    p90Days: numeric("p90_days", { precision: 8, scale: 2 }),
    source: text("source").notNull(),
    rationale: text("rationale"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    intakeLevelComputedIdx: index("intake_timeline_estimates_intake_level_idx").on(
      table.intakeId,
      table.level,
      table.computedAt,
    ),
  }),
);
