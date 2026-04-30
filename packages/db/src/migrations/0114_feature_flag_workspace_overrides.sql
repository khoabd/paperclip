-- Custom Paperclip Phase 7.1: workspace-level forced overrides for feature flags.
-- Overrides beat rollout_percent for the specific workspace (company).
-- Per Phase-7-Development-Flow-Feature-Flags §7.1.

CREATE TABLE IF NOT EXISTS "feature_flag_workspace_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "flag_id" uuid NOT NULL REFERENCES "feature_flags"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "value" boolean NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feature_flag_workspace_overrides_flag_company_idx"
  ON "feature_flag_workspace_overrides" ("flag_id", "company_id");
