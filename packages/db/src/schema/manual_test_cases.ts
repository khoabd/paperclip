import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { missions } from "./missions.js";

export const manualTestCases = pgTable(
  "manual_test_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    missionId: uuid("mission_id").references(() => missions.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    body: text("body"),
    assignedToUserId: text("assigned_to_user_id"),
    /** pending | in_progress | passed | failed | skipped */
    status: text("status").notNull().default("pending"),
    result: text("result"),
    evidenceUri: text("evidence_uri"),
    /** manual_tc | persona | exploratory */
    dimension: text("dimension").notNull(),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    companyStatusIdx: index("manual_test_cases_company_status_idx").on(
      table.companyId,
      table.status,
    ),
    assignedStatusIdx: index("manual_test_cases_assigned_status_idx").on(
      table.assignedToUserId,
      table.status,
    ),
  }),
);
