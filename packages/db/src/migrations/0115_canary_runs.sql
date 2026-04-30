-- Custom Paperclip Phase 7.1: canary rollout run tracking per feature flag.
-- Each run records staged rollout 0->5->25->50->100 with JSONB history append.
-- Per Phase-7-Development-Flow-Feature-Flags §7.1.

CREATE TABLE IF NOT EXISTS "canary_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "feature_flag_id" uuid NOT NULL REFERENCES "feature_flags"("id") ON DELETE CASCADE,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "ended_at" timestamp with time zone,
  "current_percent" integer NOT NULL DEFAULT 0,
  "history" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'running'
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canary_runs_flag_idx"
  ON "canary_runs" ("feature_flag_id", "started_at");
