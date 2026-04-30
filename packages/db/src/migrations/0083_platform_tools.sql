-- Custom Paperclip Phase 2.1: platform tool registry; bridges to mcp_servers.
-- Per Phase-2-Platform-Workspace-Mission-Layer §2.1.

CREATE TABLE IF NOT EXISTS "platform_tools" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "mcp_server_id" uuid REFERENCES "mcp_servers"("id") ON DELETE SET NULL,
  "tool_name" text NOT NULL,
  "schema_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'active',
  "description" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_tools_key_uq" ON "platform_tools" ("key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_tools_server_idx" ON "platform_tools" ("mcp_server_id");
