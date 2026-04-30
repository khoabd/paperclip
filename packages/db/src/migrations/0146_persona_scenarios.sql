CREATE TABLE "persona_scenarios" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "persona_slug" text NOT NULL,
  "scenario_text" text NOT NULL,
  "expected_outcome" text,
  "hercules_dsl" jsonb,
  "last_run_test_run_id" uuid,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "persona_scenarios_status_check" CHECK (
    "status" IN ('active', 'archived')
  )
);
--> statement-breakpoint
ALTER TABLE "persona_scenarios" ADD CONSTRAINT "persona_scenarios_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "persona_scenarios" ADD CONSTRAINT "persona_scenarios_last_run_test_run_id_fk"
  FOREIGN KEY ("last_run_test_run_id") REFERENCES "test_runs"("id") ON DELETE SET NULL;
