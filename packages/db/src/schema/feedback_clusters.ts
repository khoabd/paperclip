import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";
import { intakeItems } from "./intake_items.js";

export const feedbackClusters = pgTable(
  "feedback_clusters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    clusterSize: integer("cluster_size").notNull().default(0),
    theme: text("theme"),
    centroidIntakeId: uuid("centroid_intake_id").references(() => intakeItems.id, {
      onDelete: "set null",
    }),
    memberIntakeIds: uuid("member_intake_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    promotedToIntakeId: uuid("promoted_to_intake_id").references(() => intakeItems.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("feedback_clusters_company_status_idx").on(
      table.companyId,
      table.status,
    ),
  }),
);
