CREATE TABLE "contract_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "repo_id" uuid,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "version" text NOT NULL,
  "schema_hash" text,
  "deprecated_at" timestamp with time zone,
  "deprecated_for" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contract_versions_kind_check" CHECK (
    "kind" IN ('api', 'event', 'schema', 'protocol')
  )
);
--> statement-breakpoint
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_repo_id_fk"
  FOREIGN KEY ("repo_id") REFERENCES "kb_repositories"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_company_kind_name_version_unique"
  UNIQUE ("company_id", "kind", "name", "version");
