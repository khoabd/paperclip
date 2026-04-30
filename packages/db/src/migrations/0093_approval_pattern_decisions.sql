-- Custom Paperclip Phase 3.1: telemetry of every gate decision (auto / gate / reject).
-- Decoupled from the approvals table so we can prune.
-- Per Phase-3-Autonomy-Dial-Approval-Patterns §3.1.

CREATE TABLE IF NOT EXISTS "approval_pattern_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "approval_id" uuid REFERENCES "approvals"("id") ON DELETE SET NULL,
  "proposal_pattern" text NOT NULL,
  "autonomy_level" text NOT NULL,
  "capability_mode" text NOT NULL,
  "decision" text NOT NULL,
  "reason" text NOT NULL,
  "confidence" numeric(5,4),
  "risk_score" numeric(5,4),
  "decided_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_pattern_decisions_company_decided_idx"
  ON "approval_pattern_decisions" ("company_id", "decided_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_pattern_decisions_pattern_decision_idx"
  ON "approval_pattern_decisions" ("proposal_pattern", "decision");
