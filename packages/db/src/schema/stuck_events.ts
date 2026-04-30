import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";
import { missions } from "./missions.js";
import { missionSteps } from "./mission_steps.js";

export const stuckEvents = pgTable(
  "stuck_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    missionId: uuid("mission_id").references(() => missions.id, { onDelete: "set null" }),
    missionStepId: uuid("mission_step_id").references(() => missionSteps.id, {
      onDelete: "set null",
    }),
    rule: text("rule").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    diagnosis: jsonb("diagnosis").notNull().default({}),
    evidence: jsonb("evidence").notNull().default({}),
    autoAction: text("auto_action"),
    autoActionResult: text("auto_action_result"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNotes: text("resolution_notes"),
  },
  (table) => ({
    companyRuleIdx: index("stuck_events_company_rule_idx").on(
      table.companyId,
      table.rule,
      table.detectedAt,
    ),
    openIdx: index("stuck_events_open_idx")
      .on(table.resolvedAt)
      .where(sql`${table.resolvedAt} IS NULL`),
  }),
);
