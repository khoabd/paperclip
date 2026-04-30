import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { missions } from "./missions.js";
import { agents } from "./agents.js";
import { decisionClassLookup } from "./decision_class_lookup.js";
import { approvals } from "./approvals.js";

export const decisionLog = pgTable(
  "decision_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    missionId: uuid("mission_id").references(() => missions.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    decisionClassId: uuid("decision_class_id").references(() => decisionClassLookup.id, {
      onDelete: "set null",
    }),
    /** e.g. code_change | external_action | policy_exception | deploy | migration */
    kind: text("kind").notNull(),
    /** easy | hard | irreversible */
    reversibility: text("reversibility").notNull(),
    /** local | workspace | company | global */
    blastRadius: text("blast_radius").notNull(),
    /** Agent self-reported P(success) ∈ [0,1] */
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    /** Computed risk ∈ [0,1] */
    riskScore: numeric("risk_score", { precision: 5, scale: 4 }).notNull(),
    /** Effective threshold applied at decision time */
    thresholdUsed: numeric("threshold_used", { precision: 5, scale: 4 }).notNull(),
    /** true → required human approval before proceeding */
    gated: boolean("gated").notNull().default(false),
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "set null" }),
    /** pending | success | failure | partial | abandoned */
    outcome: text("outcome").notNull().default("pending"),
    outcomeRecordedAt: timestamp("outcome_recorded_at", { withTimezone: true }),
    /** (confidence − outcomeBinary)² — populated when outcome is recorded */
    brierContribution: numeric("brier_contribution", { precision: 8, scale: 6 }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("decision_log_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
    agentOutcomeIdx: index("decision_log_agent_outcome_idx").on(table.agentId, table.outcome),
    classOutcomeIdx: index("decision_log_class_outcome_idx").on(
      table.decisionClassId,
      table.outcome,
    ),
  }),
);
