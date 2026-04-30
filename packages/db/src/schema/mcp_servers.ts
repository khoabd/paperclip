import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { companySecrets } from "./company_secrets.js";

export const mcpServers = pgTable(
  "mcp_servers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    transport: text("transport").notNull().default("http+sse"),
    endpoint: text("endpoint").notNull(),
    authSecretId: uuid("auth_secret_id").references(() => companySecrets.id, { onDelete: "set null" }),
    status: text("status").notNull().default("enabled"),
    configJson: jsonb("config_json").notNull().default({}),
    lastHealthAt: timestamp("last_health_at", { withTimezone: true }),
    lastHealthError: text("last_health_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyKindIdx: index("mcp_servers_company_kind_idx").on(table.companyId, table.kind),
    statusIdx: index("mcp_servers_status_idx").on(table.status),
  }),
);
