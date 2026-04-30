-- Custom Paperclip Phase 6.1: human drag-in observations (Sync #4).
-- Per Phase-6-Self-Healing-Extension §6.1 + Self-Healing-and-Liveness-Design §3 Rule 7.

CREATE TABLE IF NOT EXISTS "human_drag_in_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "minutes_estimated" numeric(8,2),
  "intake_id" uuid REFERENCES "intake_items"("id") ON DELETE SET NULL,
  "actor_user_id" text,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "human_drag_in_events_company_kind_idx"
  ON "human_drag_in_events" ("company_id", "kind", "occurred_at");
