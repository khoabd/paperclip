import { pgTable, uuid, text, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { approvals } from "./approvals.js";

export const approvalPatternDecisions = pgTable(
  "approval_pattern_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "set null" }),
    proposalPattern: text("proposal_pattern").notNull(),
    autonomyLevel: text("autonomy_level").notNull(),
    capabilityMode: text("capability_mode").notNull(),
    decision: text("decision").notNull(),
    reason: text("reason").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    riskScore: numeric("risk_score", { precision: 5, scale: 4 }),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyDecidedIdx: index("approval_pattern_decisions_company_decided_idx").on(
      table.companyId,
      table.decidedAt,
    ),
    patternDecisionIdx: index("approval_pattern_decisions_pattern_decision_idx").on(
      table.proposalPattern,
      table.decision,
    ),
  }),
);
