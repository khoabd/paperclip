import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { kbDocuments } from "./kb_documents.js";

export const kbDocStaleness = pgTable(
  "kb_doc_staleness",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => kbDocuments.id, { onDelete: "cascade" }),
    score: numeric("score", { precision: 5, scale: 4 }).notNull(),
    reason: text("reason"),
    lastCheckAt: timestamp("last_check_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    documentUnique: unique("kb_doc_staleness_document_unique").on(
      table.documentId,
    ),
  }),
);
