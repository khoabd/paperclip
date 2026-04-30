import { pgTable, uuid, text, integer, jsonb, numeric, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const missionCostEvents = pgTable(
  "mission_cost_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    missionId: uuid("mission_id"),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    modelCallId: text("model_call_id").notNull(),
    model: text("model").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    metadata: jsonb("metadata").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCallUq: uniqueIndex("mission_cost_events_company_call_uq").on(
      table.companyId,
      table.modelCallId,
    ),
    companyOccurredIdx: index("mission_cost_events_company_occurred_idx").on(
      table.companyId,
      table.occurredAt,
    ),
    missionIdx: index("mission_cost_events_mission_idx").on(table.missionId),
  }),
);
