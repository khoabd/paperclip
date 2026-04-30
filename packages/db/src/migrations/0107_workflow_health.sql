-- Custom Paperclip Phase 6.1: composite per-mission and workspace-level health score.
-- Per Phase-6-Self-Healing-Extension §6.1.

CREATE TABLE IF NOT EXISTS "workflow_health" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "mission_id" uuid REFERENCES "missions"("id") ON DELETE CASCADE,
  "score" integer NOT NULL,
  "composite_state" text NOT NULL,
  "active_alerts" integer NOT NULL DEFAULT 0,
  "diagnostics" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "computed_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_health_company_mission_uq"
  ON "workflow_health" ("company_id", "mission_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_health_company_state_idx"
  ON "workflow_health" ("company_id", "composite_state");
