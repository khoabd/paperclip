-- Hotfix forward-port attempts log per Phase-13-Release-Trains §hotfix-runner.
-- Each cherry-pick attempt records its outcome so the runner has audit history
-- and can power TC-CP-08 (clean / simple-conflict / deep-conflict cases).

CREATE TABLE IF NOT EXISTS "hotfix_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "source_branch" text NOT NULL,
  "target_branch" text NOT NULL,
  "commit_sha" text NOT NULL,
  "outcome" text NOT NULL,                       -- 'clean' | 'auto_resolved' | 'escalated' | 'failed'
  "conflict_severity" text,                      -- null | 'simple' | 'deep'
  "agent_attempts" integer NOT NULL DEFAULT 0,
  "approval_id" uuid REFERENCES "approvals"("id") ON DELETE SET NULL,
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hotfix_attempts_company_started_idx"
  ON "hotfix_attempts" ("company_id", "started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hotfix_attempts_outcome_idx"
  ON "hotfix_attempts" ("outcome");
