-- Custom Paperclip Phase 2.1: platform agent catalog (no company_id).
-- Per Phase-2-Platform-Workspace-Mission-Layer §2.1.

CREATE TABLE IF NOT EXISTS "platform_agents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "role" text NOT NULL,
  "default_model" text NOT NULL,
  "prompt_template_key" text,
  "status" text NOT NULL DEFAULT 'active',
  "description" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_agents_name_uq" ON "platform_agents" ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_agents_role_idx" ON "platform_agents" ("role");
