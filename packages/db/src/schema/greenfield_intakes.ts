import {
  pgTable,
  uuid,
  text,
  numeric,
  bigint,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const greenfieldIntakes = pgTable(
  "greenfield_intakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    ideaTitle: text("idea_title").notNull(),
    ideaText: text("idea_text").notNull(),
    submitterUserId: text("submitter_user_id"),
    /** pending | running | gate_pending | done | aborted */
    status: text("status").notNull().default("pending"),
    totalCostUsd: numeric("total_cost_usd", { precision: 10, scale: 4 }),
    wallClockMs: bigint("wall_clock_ms", { mode: "number" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusCreatedIdx: index("greenfield_intakes_company_status_created_idx").on(
      table.companyId,
      table.status,
      table.createdAt,
    ),
  }),
);
