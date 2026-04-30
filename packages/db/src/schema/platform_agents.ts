import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const platformAgents = pgTable(
  "platform_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    defaultModel: text("default_model").notNull(),
    promptTemplateKey: text("prompt_template_key"),
    status: text("status").notNull().default("active"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nameUq: uniqueIndex("platform_agents_name_uq").on(table.name),
    roleIdx: index("platform_agents_role_idx").on(table.role),
  }),
);
