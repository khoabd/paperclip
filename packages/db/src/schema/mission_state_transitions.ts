import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { missions } from "./missions.js";
import { agents } from "./agents.js";

export const missionStateTransitions = pgTable(
  "mission_state_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    missionId: uuid("mission_id")
      .notNull()
      .references(() => missions.id, { onDelete: "cascade" }),
    fromStatus: text("from_status").notNull(),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    actorAgentId: uuid("actor_agent_id").references(() => agents.id, { onDelete: "set null" }),
    actorUserId: text("actor_user_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    missionOccurredIdx: index("mission_state_transitions_mission_idx").on(
      table.missionId,
      table.occurredAt,
    ),
    toStatusIdx: index("mission_state_transitions_to_status_idx").on(table.toStatus),
  }),
);
