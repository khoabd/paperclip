import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { mcpServers } from "./mcp_servers.js";

export const platformTools = pgTable(
  "platform_tools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    mcpServerId: uuid("mcp_server_id").references(() => mcpServers.id, { onDelete: "set null" }),
    toolName: text("tool_name").notNull(),
    schemaJson: jsonb("schema_json").notNull().default({}),
    status: text("status").notNull().default("active"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    keyUq: uniqueIndex("platform_tools_key_uq").on(table.key),
    serverIdx: index("platform_tools_server_idx").on(table.mcpServerId),
  }),
);
