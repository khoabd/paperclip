import { pgTable, uuid, text, integer, numeric, timestamp, index } from "drizzle-orm/pg-core";

export const brierCalibration = pgTable(
  "brier_calibration",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** agent | capability | workspace | global */
    scope: text("scope").notNull(),
    /** ID of the entity in scope (agentId, capabilityId, workspaceId, or 'global') */
    scopeId: text("scope_id").notNull(),
    windowDays: integer("window_days").notNull(),
    /** Number of decisions included in this computation */
    n: integer("n").notNull(),
    /** Mean Brier score: mean[(confidence − outcomeBinary)²] */
    brierScore: numeric("brier_score", { precision: 8, scale: 6 }).notNull(),
    meanConfidence: numeric("mean_confidence", { precision: 5, scale: 4 }),
    meanOutcome: numeric("mean_outcome", { precision: 5, scale: 4 }),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    scopeIdComputedIdx: index("brier_calibration_scope_id_computed_idx").on(
      table.scope,
      table.scopeId,
      table.computedAt,
    ),
    scopeWindowIdx: index("brier_calibration_scope_window_idx").on(
      table.scope,
      table.scopeId,
      table.windowDays,
    ),
  }),
);
