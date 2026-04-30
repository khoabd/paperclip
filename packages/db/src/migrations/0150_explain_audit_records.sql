CREATE TABLE "explain_audit_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "action_kind" text NOT NULL,
  "action_id" uuid NOT NULL,
  "decision_log_id" uuid,
  "mission_id" uuid,
  "summary" text NOT NULL,
  "full_chain" jsonb NOT NULL DEFAULT '[]',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "explain_audit_records" ADD CONSTRAINT "explain_audit_records_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "explain_audit_records" ADD CONSTRAINT "explain_audit_records_decision_log_id_fk"
  FOREIGN KEY ("decision_log_id") REFERENCES "decision_log"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "explain_audit_records" ADD CONSTRAINT "explain_audit_records_mission_id_fk"
  FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "ear_company_kind_created_idx" ON "explain_audit_records" ("company_id", "action_kind", "created_at");
--> statement-breakpoint
CREATE INDEX "ear_action_id_idx" ON "explain_audit_records" ("action_id");
