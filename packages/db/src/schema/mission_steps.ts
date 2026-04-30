import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { missions } from "./missions.js";
import { approvals } from "./approvals.js";

export const missionSteps = pgTable(
  "mission_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    missionId: uuid("mission_id")
      .notNull()
      .references(() => missions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    inputs: jsonb("inputs").notNull().default({}),
    outputs: jsonb("outputs").notNull().default({}),
    status: text("status").notNull().default("pending"),
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    missionSeqUq: uniqueIndex("mission_steps_mission_seq_uq").on(table.missionId, table.seq),
    missionStatusIdx: index("mission_steps_mission_status_idx").on(table.missionId, table.status),
  }),
);
