-- Custom Paperclip Phase 2.4: per-LLM-call cost attribution.
-- Per Phase-2-Platform-Workspace-Mission-Layer §2.4.
-- Idempotency: (company_id, model_call_id) unique to prevent double-counting.

CREATE TABLE IF NOT EXISTS "mission_cost_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "mission_id" uuid,
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "model_call_id" text NOT NULL,
  "model" text NOT NULL,
  "tokens_in" integer NOT NULL DEFAULT 0,
  "tokens_out" integer NOT NULL DEFAULT 0,
  "cost_usd" numeric(12,6) NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mission_cost_events_company_call_uq"
  ON "mission_cost_events" ("company_id", "model_call_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mission_cost_events_company_occurred_idx"
  ON "mission_cost_events" ("company_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mission_cost_events_mission_idx"
  ON "mission_cost_events" ("mission_id");
