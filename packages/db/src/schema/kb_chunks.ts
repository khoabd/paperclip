import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { kbDocuments } from "./kb_documents.js";
import { entityEmbeddings } from "./entity_embeddings.js";

export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => kbDocuments.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    body: text("body").notNull(),
    symbol: text("symbol"),
    language: text("language"),
    embeddingId: uuid("embedding_id").references(() => entityEmbeddings.id, {
      onDelete: "set null",
    }),
    tokenCount: integer("token_count"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    documentChunkUnique: unique("kb_chunks_document_chunk_unique").on(
      table.documentId,
      table.chunkIndex,
    ),
    documentSymbolIdx: index("kb_chunks_document_symbol_idx").on(
      table.documentId,
      table.symbol,
    ),
  }),
);
