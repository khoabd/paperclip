-- Custom Paperclip Phase 4.1: missions = strategic-loop unit per workspace.
-- Per Phase-4-Strategic-Loop-Foundation §4.1.

CREATE TABLE IF NOT EXISTS "missions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "goal" text NOT NULL,
  "status" text NOT NULL DEFAULT 'intake',
  "state_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "blocked_reason" text,
  "finished_at" timestamp with time zone,
  "finished_outcome" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "missions_company_status_idx" ON "missions" ("company_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "missions_company_updated_idx" ON "missions" ("company_id", "updated_at");
