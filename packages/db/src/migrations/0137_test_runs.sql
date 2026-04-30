CREATE TABLE "test_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "mission_id" uuid,
  "pr_ref" text,
  "dimension" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "score" numeric(5, 2),
  "summary" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "test_runs_dimension_check" CHECK (
    "dimension" IN (
      'visual', 'a11y', 'cross_browser', 'mobile', 'i18n',
      'ux_judge', 'fuzz', 'persona_e2e', 'synthetic', 'manual_tc'
    )
  ),
  CONSTRAINT "test_runs_status_check" CHECK (
    "status" IN ('pending', 'running', 'passed', 'failed', 'errored')
  )
);
--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_mission_id_fk"
  FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "test_runs_company_dim_status_created_idx"
  ON "test_runs" ("company_id", "dimension", "status", "created_at");
--> statement-breakpoint
CREATE INDEX "test_runs_pr_ref_idx"
  ON "test_runs" ("pr_ref");
