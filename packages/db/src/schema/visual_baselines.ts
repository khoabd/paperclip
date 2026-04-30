import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { sql } from "drizzle-orm";

export const visualBaselines = pgTable(
  "visual_baselines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    route: text("route").notNull(),
    viewport: text("viewport").notNull(),
    browser: text("browser").notNull(),
    imageUri: text("image_uri").notNull(),
    sha: text("sha").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByUserId: text("approved_by_user_id"),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    activeUniqueIdx: uniqueIndex("visual_baselines_active_unique_idx")
      .on(table.companyId, table.route, table.viewport, table.browser)
      .where(sql`${table.archived} = false`),
  }),
);
