-- Custom Paperclip Phase 4.1: append-only state transition log per mission.
-- Lets us replay or audit the strategic loop.
-- Per Phase-4-Strategic-Loop-Foundation §4.1.

CREATE TABLE IF NOT EXISTS "mission_state_transitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mission_id" uuid NOT NULL REFERENCES "missions"("id") ON DELETE CASCADE,
  "from_status" text NOT NULL,
  "to_status" text NOT NULL,
  "reason" text,
  "actor_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "actor_user_id" text,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mission_state_transitions_mission_idx"
  ON "mission_state_transitions" ("mission_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mission_state_transitions_to_status_idx"
  ON "mission_state_transitions" ("to_status");
