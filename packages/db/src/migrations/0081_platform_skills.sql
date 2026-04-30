-- Custom Paperclip Phase 2.1: platform skill catalog.
-- Per Phase-2-Platform-Workspace-Mission-Layer §2.1.

CREATE TABLE IF NOT EXISTS "platform_skills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "capability_id" uuid REFERENCES "capability_registry"("id") ON DELETE SET NULL,
  "runtime" text NOT NULL DEFAULT 'ts',
  "default_model" text,
  "status" text NOT NULL DEFAULT 'active',
  "description" text,
  "canary_pct" integer NOT NULL DEFAULT 5,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_skills_key_uq" ON "platform_skills" ("key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_skills_capability_idx" ON "platform_skills" ("capability_id");
