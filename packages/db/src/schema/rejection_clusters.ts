import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";
import { entityEmbeddings } from "./entity_embeddings.js";
import { intakeItems } from "./intake_items.js";

export const rejectionClusters = pgTable(
  "rejection_clusters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    label: text("label"),
    category: text("category"),
    memberEventIds: uuid("member_event_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    centroidEmbeddingId: uuid("centroid_embedding_id").references(
      () => entityEmbeddings.id,
      { onDelete: "set null" },
    ),
    size: integer("size").notNull().default(0),
    status: text("status").notNull().default("open"),
    autoAction: text("auto_action"),
    escalatedToIntakeId: uuid("escalated_to_intake_id").references(
      () => intakeItems.id,
      { onDelete: "set null" },
    ),
    lastRecomputedAt: timestamp("last_recomputed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyStatusRecomputedIdx: index(
      "rejection_clusters_company_status_recomputed_idx",
    ).on(table.companyId, table.status, table.lastRecomputedAt),
  }),
);
