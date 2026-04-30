import {
  pgTable,
  uuid,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { kbRepositories } from "./kb_repositories.js";

export const contractVersions = pgTable(
  "contract_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    repoId: uuid("repo_id").references(() => kbRepositories.id, { onDelete: "set null" }),
    /** api | event | schema | protocol */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    schemaHash: text("schema_hash"),
    deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
    /** Name of the replacement contract version */
    deprecatedFor: text("deprecated_for"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyKindNameVersionUnique: unique("contract_versions_company_kind_name_version_unique").on(
      table.companyId,
      table.kind,
      table.name,
      table.version,
    ),
  }),
);
