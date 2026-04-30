-- ADR-0009 completion: add the 6 columns still missing from `approvals`.
-- Pre-condition: 0092 already shipped proposal_pattern, capability_id, confidence,
-- risk_score, priority, timeout_at, delegated_to_user_id, outcome_recorded_at, outcome.
-- This migration ships the remaining ADR-0009 fields needed for risk-level surfacing,
-- timeout-action mechanics, delegation flag, decision latency, and open-ended metadata.

ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "risk_level" text;
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "timeout_hours" integer;
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "timeout_action" text;
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "can_delegate" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "time_to_decision_seconds" integer;
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_risk_level_idx"
  ON "approvals" ("company_id", "risk_level", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_delegated_idx"
  ON "approvals" ("delegated_to_user_id", "status")
  WHERE "delegated_to_user_id" IS NOT NULL;
