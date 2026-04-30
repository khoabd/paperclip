import { pgTable, uuid, text, integer, boolean, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";

export const killEvents = pgTable(
  "kill_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    level: text("level").notNull(),
    targetId: text("target_id").notNull(),
    triggeredBy: text("triggered_by").notNull(),
    reason: text("reason").notNull(),
    preserveCheckpoint: boolean("preserve_checkpoint").notNull().default(true),
    killedCount: integer("killed_count").notNull().default(0),
    refundUsd: numeric("refund_usd", { precision: 12, scale: 4 }),
    affectedMissionIds: uuid("affected_mission_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyOccurredIdx: index("kill_events_company_occurred_idx").on(
      table.companyId,
      table.occurredAt,
    ),
  }),
);
