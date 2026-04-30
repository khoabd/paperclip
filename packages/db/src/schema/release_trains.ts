import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const releaseTrains = pgTable(
  "release_trains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    featureKeys: jsonb("feature_keys").$type<string[]>().notNull().default([]),
    rationale: text("rationale"),
    mintedAt: timestamp("minted_at", { withTimezone: true }).notNull().defaultNow(),
    mintedBy: text("minted_by"),
  },
  (table) => ({
    companyTagIdx: uniqueIndex("release_trains_company_tag_idx").on(table.companyId, table.tag),
    mintedAtIdx: index("release_trains_minted_at_idx").on(table.mintedAt),
  }),
);
