-- Custom Paperclip Phase 6.1: Live mission heartbeat signal table.
-- Per Phase-6-Self-Healing-Extension §6.1.

CREATE TABLE IF NOT EXISTS "liveness_heartbeats" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mission_id" uuid NOT NULL REFERENCES "missions"("id") ON DELETE CASCADE,
  "mission_step_id" uuid REFERENCES "mission_steps"("id") ON DELETE SET NULL,
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "state" text NOT NULL,
  "progress_marker" text,
  "cost_so_far_usd" numeric(12,6),
  "tokens_so_far" integer,
  "current_tool" text,
  "waiting_on" uuid,
  "sent_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "liveness_heartbeats_mission_idx"
  ON "liveness_heartbeats" ("mission_id", "sent_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "liveness_heartbeats_active_idx"
  ON "liveness_heartbeats" ("state", "sent_at")
  WHERE "state" = 'active';
