-- Custom Paperclip Phase 2.4: detected cost spikes / runaway burn.
-- Per Phase-2-Platform-Workspace-Mission-Layer §2.4.

CREATE TABLE IF NOT EXISTS "cost_anomalies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "threshold_usd" numeric(12,4) NOT NULL DEFAULT 0,
  "actual_usd" numeric(12,4) NOT NULL DEFAULT 0,
  "ratio" numeric(8,4),
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'open',
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_anomalies_company_status_idx"
  ON "cost_anomalies" ("company_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_anomalies_occurred_idx"
  ON "cost_anomalies" ("occurred_at");
