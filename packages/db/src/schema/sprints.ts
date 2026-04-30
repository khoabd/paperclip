import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";

export const sprints = pgTable(
  "sprints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    goal: text("goal"),
    status: text("status").notNull().default("planning"),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    velocity: integer("velocity"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("sprints_company_idx").on(table.companyId),
    projectIdx: index("sprints_project_idx").on(table.projectId),
  }),
);

export const sprintIssues = pgTable(
  "sprint_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sprintId: uuid("sprint_id").notNull().references(() => sprints.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sprintIdx: index("sprint_issues_sprint_idx").on(table.sprintId),
    issueIdx: index("sprint_issues_issue_idx").on(table.issueId),
  }),
);
