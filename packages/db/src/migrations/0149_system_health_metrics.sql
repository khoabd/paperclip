CREATE TABLE "system_health_metrics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "scope" text NOT NULL,
  "scope_id" text,
  "kind" text NOT NULL,
  "value" numeric(12,4),
  "threshold" numeric(12,4),
  "status" text DEFAULT 'green' NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}',
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "system_health_metrics" ADD CONSTRAINT "system_health_metrics_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "shm_company_scope_kind_recorded_idx" ON "system_health_metrics" ("company_id", "scope", "kind", "recorded_at");
