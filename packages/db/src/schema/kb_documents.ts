import {
  pgTable,
  uuid,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { kbRepositories } from "./kb_repositories.js";
import { entityEmbeddings } from "./entity_embeddings.js";

export const kbDocuments = pgTable(
  "kb_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => kbRepositories.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    path: text("path").notNull(),
    language: text("language"),
    sha: text("sha"),
    body: text("body"),
    summary: text("summary"),
    lastModifiedAt: timestamp("last_modified_at", { withTimezone: true }),
    embeddingId: uuid("embedding_id").references(() => entityEmbeddings.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("fresh"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    repoPathUnique: unique("kb_documents_repo_path_unique").on(
      table.repoId,
      table.path,
    ),
  }),
);
