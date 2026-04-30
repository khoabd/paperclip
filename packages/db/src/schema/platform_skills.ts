import { pgTable, uuid, text, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { capabilityRegistry } from "./capability_registry.js";

export const platformSkills = pgTable(
  "platform_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    capabilityId: uuid("capability_id").references(() => capabilityRegistry.id, { onDelete: "set null" }),
    runtime: text("runtime").notNull().default("ts"),
    defaultModel: text("default_model"),
    status: text("status").notNull().default("active"),
    description: text("description"),
    canaryPct: integer("canary_pct").notNull().default(5),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    keyUq: uniqueIndex("platform_skills_key_uq").on(table.key),
    capabilityIdx: index("platform_skills_capability_idx").on(table.capabilityId),
  }),
);
