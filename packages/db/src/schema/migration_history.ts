import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const migrationHistory = pgTable(
  "migration_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    target: text("target").notNull(),
    /** paperclip_company_to_workspace | paperclip_issue_to_mission |
     *  capability_seed | template_install */
    kind: text("kind").notNull(),
    /** pending | running | completed | failed | rolled_back */
    status: text("status").notNull().default("pending"),
    recordsMigrated: integer("records_migrated").notNull().default(0),
    errors: jsonb("errors").$type<unknown[]>().notNull().default([]),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => ({
    targetStatusStartedIdx: index("mh_target_status_started_idx").on(
      table.target,
      table.status,
      table.startedAt,
    ),
  }),
);
