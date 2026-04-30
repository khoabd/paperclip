-- Custom Paperclip Phase 1: audit log for every MCP tool call.
-- Per Phase-1-External-Integrations §2.2.

CREATE TABLE IF NOT EXISTS "mcp_tool_invocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mcp_server_id" uuid NOT NULL REFERENCES "mcp_servers"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "mission_id" uuid,
  "tool_name" text NOT NULL,
  "request_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "response_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "duration_ms" integer NOT NULL DEFAULT 0,
  "error" text,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_invocations_company_occurred_idx" ON "mcp_tool_invocations" ("company_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_invocations_server_occurred_idx" ON "mcp_tool_invocations" ("mcp_server_id", "occurred_at");
