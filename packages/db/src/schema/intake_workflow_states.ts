import { pgTable, uuid, text, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { intakeItems } from "./intake_items.js";
import { agents } from "./agents.js";

export const intakeWorkflowStates = pgTable(
  "intake_workflow_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    intakeId: uuid("intake_id")
      .notNull()
      .references(() => intakeItems.id, { onDelete: "cascade" }),
    state: text("state").notNull(),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    durationMin: numeric("duration_min", { precision: 10, scale: 2 }),
    actorAgentId: uuid("actor_agent_id").references(() => agents.id, { onDelete: "set null" }),
    actorUserId: text("actor_user_id"),
    notes: text("notes"),
  },
  (table) => ({
    intakeEnteredIdx: index("intake_workflow_states_intake_idx").on(
      table.intakeId,
      table.enteredAt,
    ),
  }),
);
