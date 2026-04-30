-- Custom Paperclip Phase 1: external MCP server registry
-- Per Phase-1-External-Integrations §2.1.

CREATE TABLE IF NOT EXISTS "mcp_servers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "transport" text NOT NULL DEFAULT 'http+sse',
  "endpoint" text NOT NULL,
  "auth_secret_id" uuid REFERENCES "company_secrets"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'enabled',
  "config_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_health_at" timestamp with time zone,
  "last_health_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_servers_company_kind_idx" ON "mcp_servers" ("company_id", "kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_servers_status_idx" ON "mcp_servers" ("status");
