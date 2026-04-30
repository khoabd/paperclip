import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const missions = pgTable(
  "missions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    goal: text("goal").notNull(),
    status: text("status").notNull().default("intake"),
    statePayload: jsonb("state_payload").notNull().default({}),
    blockedReason: text("blocked_reason"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    finishedOutcome: text("finished_outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("missions_company_status_idx").on(table.companyId, table.status),
    companyUpdatedIdx: index("missions_company_updated_idx").on(table.companyId, table.updatedAt),
  }),
);
