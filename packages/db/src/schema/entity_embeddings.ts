import { pgTable, uuid, text, integer, timestamp, real, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const entityEmbeddings = pgTable(
  "entity_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    chunkIndex: integer("chunk_index").notNull().default(0),
    chunkText: text("chunk_text").notNull(),
    model: text("model").notNull().default("text-embedding-3-small"),
    embedding: real("embedding").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyEntityIdx: index("entity_embeddings_company_entity_idx").on(
      table.companyId,
      table.entityType,
      table.entityId,
    ),
    companyTypeCreatedIdx: index("entity_embeddings_company_type_created_idx").on(
      table.companyId,
      table.entityType,
      table.createdAt,
    ),
  }),
);
