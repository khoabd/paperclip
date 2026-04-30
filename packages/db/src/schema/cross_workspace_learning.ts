import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const crossWorkspaceLearning = pgTable(
  "cross_workspace_learning",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    payload: jsonb("payload").notNull().default({}),
    observedCount: integer("observed_count").notNull().default(1),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull().defaultNow(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    kindKeyUq: uniqueIndex("cross_workspace_learning_kind_key_uq").on(table.kind, table.key),
    kindIdx: index("cross_workspace_learning_kind_idx").on(table.kind, table.observedCount),
  }),
);
