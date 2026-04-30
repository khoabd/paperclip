import { pgTable, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { mcpServers } from "./mcp_servers.js";

export const mcpToolInvocations = pgTable(
  "mcp_tool_invocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mcpServerId: uuid("mcp_server_id").notNull().references(() => mcpServers.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    missionId: uuid("mission_id"),
    toolName: text("tool_name").notNull(),
    requestJson: jsonb("request_json").notNull().default({}),
    responseSummary: jsonb("response_summary").notNull().default({}),
    durationMs: integer("duration_ms").notNull().default(0),
    error: text("error"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyOccurredIdx: index("mcp_invocations_company_occurred_idx").on(table.companyId, table.occurredAt),
    serverOccurredIdx: index("mcp_invocations_server_occurred_idx").on(table.mcpServerId, table.occurredAt),
  }),
);
