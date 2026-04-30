-- Custom Paperclip Phase 6.1: detected stuck-mission events with diagnosis + auto action.
-- Per Phase-6-Self-Healing-Extension §6.1.

CREATE TABLE IF NOT EXISTS "stuck_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "mission_id" uuid REFERENCES "missions"("id") ON DELETE SET NULL,
  "mission_step_id" uuid REFERENCES "mission_steps"("id") ON DELETE SET NULL,
  "rule" text NOT NULL,
  "detected_at" timestamp with time zone NOT NULL DEFAULT now(),
  "diagnosis" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "auto_action" text,
  "auto_action_result" text,
  "resolved_at" timestamp with time zone,
  "resolution_notes" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stuck_events_company_rule_idx"
  ON "stuck_events" ("company_id", "rule", "detected_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stuck_events_open_idx"
  ON "stuck_events" ("resolved_at")
  WHERE "resolved_at" IS NULL;
