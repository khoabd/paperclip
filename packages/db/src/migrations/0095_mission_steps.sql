-- Custom Paperclip Phase 4.1: ordered steps within a mission's strategic loop.
-- Per Phase-4-Strategic-Loop-Foundation §4.1.

CREATE TABLE IF NOT EXISTS "mission_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mission_id" uuid NOT NULL REFERENCES "missions"("id") ON DELETE CASCADE,
  "seq" integer NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "inputs" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "outputs" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'pending',
  "approval_id" uuid REFERENCES "approvals"("id") ON DELETE SET NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mission_steps_mission_seq_uq" ON "mission_steps" ("mission_id", "seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mission_steps_mission_status_idx" ON "mission_steps" ("mission_id", "status");
