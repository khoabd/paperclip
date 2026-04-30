-- Custom Paperclip Phase 6.1: kill switch audit log (5 levels).
-- Per Phase-6-Self-Healing-Extension §6.1.

CREATE TABLE IF NOT EXISTS "kill_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid REFERENCES "companies"("id") ON DELETE SET NULL,
  "level" text NOT NULL,
  "target_id" text NOT NULL,
  "triggered_by" text NOT NULL,
  "reason" text NOT NULL,
  "preserve_checkpoint" boolean NOT NULL DEFAULT true,
  "killed_count" integer NOT NULL DEFAULT 0,
  "refund_usd" numeric(12,4),
  "affected_mission_ids" uuid[] NOT NULL DEFAULT '{}'::uuid[],
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kill_events_company_occurred_idx"
  ON "kill_events" ("company_id", "occurred_at");
