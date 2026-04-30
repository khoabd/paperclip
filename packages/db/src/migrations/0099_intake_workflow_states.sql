-- Custom Paperclip Phase 5.1: per-intake state log.
-- Per Phase-5-Human-Intake-Hub §5.1.

CREATE TABLE IF NOT EXISTS "intake_workflow_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intake_id" uuid NOT NULL REFERENCES "intake_items"("id") ON DELETE CASCADE,
  "state" text NOT NULL,
  "entered_at" timestamp with time zone NOT NULL DEFAULT now(),
  "left_at" timestamp with time zone,
  "duration_min" numeric(10,2),
  "actor_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "actor_user_id" text,
  "notes" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_workflow_states_intake_idx"
  ON "intake_workflow_states" ("intake_id", "entered_at");
