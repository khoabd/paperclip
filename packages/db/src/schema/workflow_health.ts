import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { missions } from "./missions.js";

export const workflowHealth = pgTable(
  "workflow_health",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    missionId: uuid("mission_id").references(() => missions.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    compositeState: text("composite_state").notNull(),
    activeAlerts: integer("active_alerts").notNull().default(0),
    diagnostics: jsonb("diagnostics").notNull().default({}),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyMissionUq: uniqueIndex("workflow_health_company_mission_uq").on(
      table.companyId,
      table.missionId,
    ),
    companyStateIdx: index("workflow_health_company_state_idx").on(
      table.companyId,
      table.compositeState,
    ),
  }),
);
