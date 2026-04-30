import { pgTable, uuid, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { intakeItems } from "./intake_items.js";

export const intakeOutcomeTracker = pgTable("intake_outcome_tracker", {
  intakeId: uuid("intake_id")
    .primaryKey()
    .references(() => intakeItems.id, { onDelete: "cascade" }),
  predictedEtaP50Days: numeric("predicted_eta_p50_days", { precision: 8, scale: 2 }),
  actualDays: numeric("actual_days", { precision: 8, scale: 2 }),
  predictedCostUsd: numeric("predicted_cost_usd", { precision: 10, scale: 4 }),
  actualCostUsd: numeric("actual_cost_usd", { precision: 10, scale: 4 }),
  acceptanceStatus: text("acceptance_status"),
  submitterSatisfaction: integer("submitter_satisfaction"),
  measuredAt: timestamp("measured_at", { withTimezone: true }),
});
