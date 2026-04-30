import { pgTable, uuid, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const capabilityRegistry = pgTable(
  "capability_registry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    defaultMode: text("default_mode").notNull().default("sandbox"),
    riskTier: text("risk_tier").notNull().default("low"),
    brierWindowDays: integer("brier_window_days").notNull().default(30),
    owner: text("owner"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nameUq: uniqueIndex("capability_registry_name_uq").on(table.name),
  }),
);
