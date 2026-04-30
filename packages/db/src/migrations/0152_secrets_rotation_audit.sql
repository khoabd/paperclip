CREATE TABLE "secrets_rotation_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "secret_name" text NOT NULL,
  "kind" text NOT NULL,
  "action" text NOT NULL,
  "rotated_by_user_id" text,
  "expires_at" timestamp with time zone,
  "succeeded" boolean DEFAULT true NOT NULL,
  "error" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "secrets_rotation_audit" ADD CONSTRAINT "secrets_rotation_audit_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "sra_company_secret_occurred_idx" ON "secrets_rotation_audit" ("company_id", "secret_name", "occurred_at");
