import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { missions } from "./missions.js";

export const testRuns = pgTable(
  "test_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    missionId: uuid("mission_id").references(() => missions.id, { onDelete: "set null" }),
    prRef: text("pr_ref"),
    /** visual | a11y | cross_browser | mobile | i18n | ux_judge | fuzz | persona_e2e | synthetic | manual_tc */
    dimension: text("dimension").notNull(),
    /** pending | running | passed | failed | errored */
    status: text("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    score: numeric("score", { precision: 5, scale: 2 }),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyDimStatusCreatedIdx: index("test_runs_company_dim_status_created_idx").on(
      table.companyId,
      table.dimension,
      table.status,
      table.createdAt,
    ),
    prRefIdx: index("test_runs_pr_ref_idx").on(table.prRef),
  }),
);
