import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { designDocs } from "./design_docs.js";

export const componentLocks = pgTable(
  "component_locks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    componentPath: text("component_path").notNull(),
    lockedByDesignDocId: uuid("locked_by_design_doc_id").references(() => designDocs.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerIdx: uniqueIndex("component_locks_owner_idx").on(
      table.companyId,
      table.projectId,
      table.componentPath,
    ),
  }),
);
