import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import { sagas } from "./sagas.js";

export const sagaSteps = pgTable(
  "saga_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sagaId: uuid("saga_id")
      .notNull()
      .references(() => sagas.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    name: text("name").notNull(),
    /** pending | running | done | failed | compensated */
    status: text("status").notNull().default("pending"),
    forwardAction: jsonb("forward_action").$type<Record<string, unknown>>(),
    compensateAction: jsonb("compensate_action").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
  },
  (table) => ({
    sagaSequenceUnique: unique("saga_steps_saga_sequence_unique").on(
      table.sagaId,
      table.sequence,
    ),
  }),
);
