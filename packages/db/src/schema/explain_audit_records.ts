import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { decisionLog } from "./decision_log.js";
import { missions } from "./missions.js";

export const explainAuditRecords = pgTable(
  "explain_audit_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** mission_state_change | approval | kill | design_doc_transition |
     *  feature_flag_change | intake_decision */
    actionKind: text("action_kind").notNull(),
    actionId: uuid("action_id").notNull(),
    decisionLogId: uuid("decision_log_id").references(() => decisionLog.id, {
      onDelete: "set null",
    }),
    missionId: uuid("mission_id").references(() => missions.id, { onDelete: "set null" }),
    summary: text("summary").notNull(),
    fullChain: jsonb("full_chain").$type<unknown[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyKindCreatedIdx: index("ear_company_kind_created_idx").on(
      table.companyId,
      table.actionKind,
      table.createdAt,
    ),
    actionIdIdx: index("ear_action_id_idx").on(table.actionId),
  }),
);
