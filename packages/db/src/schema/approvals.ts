import { pgTable, uuid, text, timestamp, jsonb, numeric, integer, boolean, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { capabilityRegistry } from "./capability_registry.js";

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    type: text("type").notNull(),
    requestedByAgentId: uuid("requested_by_agent_id").references(() => agents.id),
    requestedByUserId: text("requested_by_user_id"),
    status: text("status").notNull().default("pending"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    decisionNote: text("decision_note"),
    decidedByUserId: text("decided_by_user_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    proposalPattern: text("proposal_pattern"),
    capabilityId: uuid("capability_id").references(() => capabilityRegistry.id, { onDelete: "set null" }),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    riskScore: numeric("risk_score", { precision: 5, scale: 4 }),
    riskLevel: text("risk_level"),
    priority: text("priority").notNull().default("medium"),
    timeoutAt: timestamp("timeout_at", { withTimezone: true }),
    timeoutHours: integer("timeout_hours"),
    timeoutAction: text("timeout_action"),
    canDelegate: boolean("can_delegate").notNull().default(false),
    delegatedToUserId: text("delegated_to_user_id"),
    timeToDecisionSeconds: integer("time_to_decision_seconds"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    outcomeRecordedAt: timestamp("outcome_recorded_at", { withTimezone: true }),
    outcome: text("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusTypeIdx: index("approvals_company_status_type_idx").on(
      table.companyId,
      table.status,
      table.type,
    ),
    companyStatusPriorityIdx: index("approvals_company_status_priority_idx").on(
      table.companyId,
      table.status,
      table.priority,
    ),
    patternIdx: index("approvals_pattern_idx").on(table.proposalPattern, table.status),
    riskLevelIdx: index("approvals_risk_level_idx").on(table.companyId, table.riskLevel, table.status),
    delegatedIdx: index("approvals_delegated_idx").on(table.delegatedToUserId, table.status),
  }),
);
