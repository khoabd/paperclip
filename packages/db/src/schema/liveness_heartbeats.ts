import { pgTable, uuid, text, integer, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { missions } from "./missions.js";
import { missionSteps } from "./mission_steps.js";
import { agents } from "./agents.js";

export const livenessHeartbeats = pgTable(
  "liveness_heartbeats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    missionId: uuid("mission_id")
      .notNull()
      .references(() => missions.id, { onDelete: "cascade" }),
    missionStepId: uuid("mission_step_id").references(() => missionSteps.id, {
      onDelete: "set null",
    }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    state: text("state").notNull(),
    progressMarker: text("progress_marker"),
    costSoFarUsd: numeric("cost_so_far_usd", { precision: 12, scale: 6 }),
    tokensSoFar: integer("tokens_so_far"),
    currentTool: text("current_tool"),
    waitingOn: uuid("waiting_on"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    missionSentIdx: index("liveness_heartbeats_mission_idx").on(table.missionId, table.sentAt),
    activeIdx: index("liveness_heartbeats_active_idx")
      .on(table.state, table.sentAt)
      .where(sql`${table.state} = 'active'`),
  }),
);
