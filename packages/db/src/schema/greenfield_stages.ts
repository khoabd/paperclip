import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { greenfieldIntakes } from "./greenfield_intakes.js";
import { approvals } from "./approvals.js";

export const greenfieldStages = pgTable(
  "greenfield_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    intakeId: uuid("intake_id")
      .notNull()
      .references(() => greenfieldIntakes.id, { onDelete: "cascade" }),
    stageName: text("stage_name").notNull(),
    sequence: integer("sequence").notNull(),
    /** pending | running | done | failed | gated */
    status: text("status").notNull().default("pending"),
    inputs: jsonb("inputs").notNull().default({}),
    outputs: jsonb("outputs").notNull().default({}),
    gateApprovalId: uuid("gate_approval_id").references(() => approvals.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
  },
  (table) => ({
    intakeSeqUidx: uniqueIndex("greenfield_stages_intake_seq_uidx").on(
      table.intakeId,
      table.sequence,
    ),
    intakeStatusIdx: index("greenfield_stages_intake_status_idx").on(
      table.intakeId,
      table.status,
    ),
  }),
);
