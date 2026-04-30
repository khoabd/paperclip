import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { kbDocuments } from "./kb_documents.js";
import { entityEmbeddings } from "./entity_embeddings.js";

export const codeSymbols = pgTable(
  "code_symbols",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => kbDocuments.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    signature: text("signature"),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    parentSymbolId: uuid("parent_symbol_id"),
    embeddingId: uuid("embedding_id").references(() => entityEmbeddings.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    documentKindIdx: index("code_symbols_document_kind_idx").on(
      table.documentId,
      table.kind,
    ),
  }),
);
