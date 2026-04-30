-- Custom Paperclip Phase 5.1: solution candidates per intake.
-- Per Phase-5-Human-Intake-Hub §5.1.

CREATE TABLE IF NOT EXISTS "intake_solutions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intake_id" uuid NOT NULL REFERENCES "intake_items"("id") ON DELETE CASCADE,
  "candidate_idx" integer NOT NULL,
  "title" text NOT NULL,
  "scope" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "effort_days" numeric(8,2),
  "risk_score" numeric(5,4),
  "eta_p50_days" numeric(8,2),
  "eta_p90_days" numeric(8,2),
  "cost_usd" numeric(10,4),
  "selected" boolean NOT NULL DEFAULT false,
  "selection_reason" text,
  "approval_id" uuid REFERENCES "approvals"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intake_solutions_intake_candidate_uq"
  ON "intake_solutions" ("intake_id", "candidate_idx");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_solutions_intake_selected_idx"
  ON "intake_solutions" ("intake_id", "selected");
