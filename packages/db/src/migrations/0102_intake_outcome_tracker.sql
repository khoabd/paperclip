-- Custom Paperclip Phase 5.1: predicted vs actual outcome per intake.
-- Populated by Phase 6 daily T+7 cron; pre-allocated row at approved_solution.
-- Per Phase-5-Human-Intake-Hub §5.1.

CREATE TABLE IF NOT EXISTS "intake_outcome_tracker" (
  "intake_id" uuid PRIMARY KEY REFERENCES "intake_items"("id") ON DELETE CASCADE,
  "predicted_eta_p50_days" numeric(8,2),
  "actual_days" numeric(8,2),
  "predicted_cost_usd" numeric(10,4),
  "actual_cost_usd" numeric(10,4),
  "acceptance_status" text,
  "submitter_satisfaction" integer,
  "measured_at" timestamp with time zone
);
