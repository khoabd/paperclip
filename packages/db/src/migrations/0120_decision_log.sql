CREATE TABLE "decision_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "mission_id" uuid REFERENCES "missions"("id") ON DELETE SET NULL,
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "decision_class_id" uuid REFERENCES "decision_class_lookup"("id") ON DELETE SET NULL,
  "kind" text NOT NULL,
  "reversibility" text NOT NULL,
  "blast_radius" text NOT NULL,
  "confidence" numeric(5,4) NOT NULL,
  "risk_score" numeric(5,4) NOT NULL,
  "threshold_used" numeric(5,4) NOT NULL,
  "gated" boolean NOT NULL DEFAULT false,
  "approval_id" uuid REFERENCES "approvals"("id") ON DELETE SET NULL,
  "outcome" text NOT NULL DEFAULT 'pending',
  "outcome_recorded_at" timestamp with time zone,
  "brier_contribution" numeric(8,6),
  "payload" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "decision_log_company_created_idx" ON "decision_log" ("company_id", "created_at");
--> statement-breakpoint
CREATE INDEX "decision_log_agent_outcome_idx" ON "decision_log" ("agent_id", "outcome");
--> statement-breakpoint
CREATE INDEX "decision_log_class_outcome_idx" ON "decision_log" ("decision_class_id", "outcome");
