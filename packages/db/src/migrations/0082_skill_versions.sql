-- Custom Paperclip Phase 2.1: skill semver track + canary stats.
-- Per Phase-2-Platform-Workspace-Mission-Layer §2.1.

CREATE TABLE IF NOT EXISTS "skill_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "skill_id" uuid NOT NULL REFERENCES "platform_skills"("id") ON DELETE CASCADE,
  "version" text NOT NULL,
  "code_path" text NOT NULL,
  "input_schema" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "output_schema" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'canary',
  "cost_p50_usd" numeric(10,4),
  "brier_30d" numeric(5,4),
  "rejection_rate_7d" numeric(5,4),
  "released_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "skill_versions_skill_version_uq" ON "skill_versions" ("skill_id", "version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_versions_status_idx" ON "skill_versions" ("skill_id", "status");
