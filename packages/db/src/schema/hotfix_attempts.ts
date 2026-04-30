import { pgTable, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { approvals } from "./approvals.js";

export const hotfixAttempts = pgTable(
  "hotfix_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    sourceBranch: text("source_branch").notNull(),
    targetBranch: text("target_branch").notNull(),
    commitSha: text("commit_sha").notNull(),
    outcome: text("outcome").notNull(),
    conflictSeverity: text("conflict_severity"),
    agentAttempts: integer("agent_attempts").notNull().default(0),
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "set null" }),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => ({
    companyStartedIdx: index("hotfix_attempts_company_started_idx").on(table.companyId, table.startedAt),
    outcomeIdx: index("hotfix_attempts_outcome_idx").on(table.outcome),
  }),
);
