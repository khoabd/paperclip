import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

export const rejectionTaxonomy = pgTable("rejection_taxonomy", {
  id: uuid("id").primaryKey().defaultRandom(),
  category: text("category").notNull().unique(),
  subCategory: text("sub_category"),
  description: text("description"),
  defaultSeverity: integer("default_severity"),
  recommendedAction: text("recommended_action"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
