CREATE TABLE "manual_test_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "mission_id" uuid,
  "title" text NOT NULL,
  "body" text,
  "assigned_to_user_id" text,
  "status" text NOT NULL DEFAULT 'pending',
  "result" text,
  "evidence_uri" text,
  "dimension" text NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "manual_test_cases_status_check" CHECK (
    "status" IN ('pending', 'in_progress', 'passed', 'failed', 'skipped')
  ),
  CONSTRAINT "manual_test_cases_dimension_check" CHECK (
    "dimension" IN ('manual_tc', 'persona', 'exploratory')
  )
);
--> statement-breakpoint
ALTER TABLE "manual_test_cases" ADD CONSTRAINT "manual_test_cases_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "manual_test_cases" ADD CONSTRAINT "manual_test_cases_mission_id_fk"
  FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "manual_test_cases_company_status_idx" ON "manual_test_cases" ("company_id", "status");
--> statement-breakpoint
CREATE INDEX "manual_test_cases_assigned_status_idx" ON "manual_test_cases" ("assigned_to_user_id", "status");
