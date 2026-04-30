import { pgTable, uuid, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { greenfieldStages } from "./greenfield_stages.js";

export const intakeRecoveryActions = pgTable(
  "intake_recovery_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => greenfieldStages.id, { onDelete: "cascade" }),
    /** retry | alt_path | skip | abort */
    kind: text("kind").notNull(),
    attemptNumber: integer("attempt_number").notNull().default(1),
    action: jsonb("action").notNull().default({}),
    result: text("result"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    stageIdx: index("intake_recovery_actions_stage_idx").on(table.stageId, table.occurredAt),
  }),
);
