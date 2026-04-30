CREATE TABLE "kb_repositories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "repo_url" text NOT NULL,
  "name" text NOT NULL,
  "default_branch" text,
  "primary_language" text,
  "status" text NOT NULL DEFAULT 'pending',
  "last_indexed_at" timestamp with time zone,
  "magika_inventory_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "kb_repositories_status_check" CHECK (
    "status" IN ('pending','indexing','indexed','stale','error')
  ),
  CONSTRAINT "kb_repositories_company_repo_unique" UNIQUE ("company_id", "repo_url")
);
--> statement-breakpoint
ALTER TABLE "kb_repositories" ADD CONSTRAINT "kb_repositories_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "kb_repositories_company_status_idx"
  ON "kb_repositories" ("company_id", "status");
