-- Custom Paperclip Phase 2.4: rolling weekly LLM quota per workspace.
-- Per Phase-2-Platform-Workspace-Mission-Layer §2.4.

CREATE TABLE IF NOT EXISTS "llm_quota_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "week_start" date NOT NULL,
  "tokens_used" integer NOT NULL DEFAULT 0,
  "cost_used_usd" numeric(12,6) NOT NULL DEFAULT 0,
  "calls" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'within',
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "llm_quota_state_company_week_uq"
  ON "llm_quota_state" ("company_id", "week_start");
