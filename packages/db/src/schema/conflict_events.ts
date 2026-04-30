import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";
import { designDocs } from "./design_docs.js";

export const conflictEvents = pgTable(
  "conflict_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    designDocAId: uuid("design_doc_a_id").references(() => designDocs.id, {
      onDelete: "set null",
    }),
    designDocBId: uuid("design_doc_b_id").references(() => designDocs.id, {
      onDelete: "set null",
    }),
    detail: jsonb("detail").notNull().default({}),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNotes: text("resolution_notes"),
  },
  (table) => ({
    companyKindIdx: index("conflict_events_company_kind_idx").on(
      table.companyId,
      table.kind,
      table.detectedAt,
    ),
    openIdx: index("conflict_events_open_idx")
      .on(table.companyId, table.detectedAt)
      .where(sql`${table.resolvedAt} IS NULL`),
  }),
);
