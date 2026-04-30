import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const kbRepositories = pgTable(
  "kb_repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    repoUrl: text("repo_url").notNull(),
    name: text("name").notNull(),
    defaultBranch: text("default_branch"),
    primaryLanguage: text("primary_language"),
    status: text("status").notNull().default("pending"),
    lastIndexedAt: timestamp("last_indexed_at", { withTimezone: true }),
    magikaInventoryId: uuid("magika_inventory_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyRepoUnique: unique("kb_repositories_company_repo_unique").on(
      table.companyId,
      table.repoUrl,
    ),
    companyStatusIdx: index("kb_repositories_company_status_idx").on(
      table.companyId,
      table.status,
    ),
  }),
);
