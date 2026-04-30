import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { missions } from "./missions.js";

export const agentUncertaintyEvents = pgTable(
  "agent_uncertainty_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    missionId: uuid("mission_id").references(() => missions.id, { onDelete: "set null" }),
    /** low_confidence | conflicting_signals | stale_data | disputed_outcome | unknown_class */
    kind: text("kind").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => ({
    agentKindObsIdx: index("agent_uncertainty_events_agent_kind_obs_idx").on(
      table.agentId,
      table.kind,
      table.observedAt,
    ),
  }),
);
