import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  numeric,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { intakeItems } from "./intake_items.js";
import { approvals } from "./approvals.js";

export const intakeSolutions = pgTable(
  "intake_solutions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    intakeId: uuid("intake_id")
      .notNull()
      .references(() => intakeItems.id, { onDelete: "cascade" }),
    candidateIdx: integer("candidate_idx").notNull(),
    title: text("title").notNull(),
    scope: jsonb("scope").notNull().default({}),
    effortDays: numeric("effort_days", { precision: 8, scale: 2 }),
    riskScore: numeric("risk_score", { precision: 5, scale: 4 }),
    etaP50Days: numeric("eta_p50_days", { precision: 8, scale: 2 }),
    etaP90Days: numeric("eta_p90_days", { precision: 8, scale: 2 }),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
    selected: boolean("selected").notNull().default(false),
    selectionReason: text("selection_reason"),
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    intakeCandidateUq: uniqueIndex("intake_solutions_intake_candidate_uq").on(
      table.intakeId,
      table.candidateIdx,
    ),
    intakeSelectedIdx: index("intake_solutions_intake_selected_idx").on(
      table.intakeId,
      table.selected,
    ),
  }),
);
