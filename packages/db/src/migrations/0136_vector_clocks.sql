CREATE TABLE "vector_clocks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "scope" text NOT NULL,
  "scope_id" text NOT NULL,
  "clock" jsonb NOT NULL DEFAULT '{}',
  "last_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vector_clocks" ADD CONSTRAINT "vector_clocks_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "vector_clocks" ADD CONSTRAINT "vector_clocks_company_scope_scope_id_unique"
  UNIQUE ("company_id", "scope", "scope_id");
