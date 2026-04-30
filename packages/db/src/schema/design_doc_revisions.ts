import { pgTable, uuid, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { designDocs } from "./design_docs.js";

export const designDocRevisions = pgTable(
  "design_doc_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    designDocId: uuid("design_doc_id")
      .notNull()
      .references(() => designDocs.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    body: text("body").notNull(),
    changeSummary: text("change_summary"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    docRevIdx: uniqueIndex("design_doc_revisions_doc_rev_idx").on(
      table.designDocId,
      table.revisionNumber,
    ),
  }),
);
