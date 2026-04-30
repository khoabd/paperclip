CREATE TABLE "kb_coverage_gaps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "repo_id" uuid NOT NULL,
  "kind" text,
  "target_path" text,
  "severity" integer,
  "suggested_action" text,
  "status" text NOT NULL DEFAULT 'open',
  "detected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  CONSTRAINT "kb_coverage_gaps_kind_check" CHECK (
    "kind" IN ('missing_readme','missing_adr','missing_api_spec','stale_doc','orphan_doc')
  )
);
--> statement-breakpoint
ALTER TABLE "kb_coverage_gaps" ADD CONSTRAINT "kb_coverage_gaps_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "kb_coverage_gaps" ADD CONSTRAINT "kb_coverage_gaps_repo_id_fk"
  FOREIGN KEY ("repo_id") REFERENCES "kb_repositories"("id") ON DELETE CASCADE;
