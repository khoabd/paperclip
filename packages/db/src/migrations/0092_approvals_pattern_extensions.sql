-- Custom Paperclip Phase 3.1: extend approvals with proposal-pattern + gate inputs.
-- Per ADR-0009 (extend, do NOT add approval_items) and Phase-3-Autonomy-Dial-Approval-Patterns §3.1.

ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "proposal_pattern" text;
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "capability_id" uuid REFERENCES "capability_registry"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "confidence" numeric(5,4);
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "risk_score" numeric(5,4);
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "priority" text NOT NULL DEFAULT 'medium';
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "timeout_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "delegated_to_user_id" text;
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "outcome_recorded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "outcome" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_company_status_priority_idx"
  ON "approvals" ("company_id", "status", "priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_pending_timeout_idx"
  ON "approvals" ("timeout_at")
  WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_pattern_idx"
  ON "approvals" ("proposal_pattern", "status");
