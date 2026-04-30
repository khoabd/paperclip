CREATE TABLE "kb_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "repo_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "path" text NOT NULL,
  "language" text,
  "sha" text,
  "body" text,
  "summary" text,
  "last_modified_at" timestamp with time zone,
  "embedding_id" uuid,
  "status" text NOT NULL DEFAULT 'fresh',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "kb_documents_kind_check" CHECK (
    "kind" IN ('code','api_spec','adr','readme','design','persona')
  ),
  CONSTRAINT "kb_documents_status_check" CHECK (
    "status" IN ('fresh','stale','deprecated')
  ),
  CONSTRAINT "kb_documents_repo_path_unique" UNIQUE ("repo_id", "path")
);
--> statement-breakpoint
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_repo_id_fk"
  FOREIGN KEY ("repo_id") REFERENCES "kb_repositories"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_embedding_id_fk"
  FOREIGN KEY ("embedding_id") REFERENCES "entity_embeddings"("id") ON DELETE SET NULL;
