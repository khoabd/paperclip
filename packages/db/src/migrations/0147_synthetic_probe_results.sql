CREATE TABLE "synthetic_probe_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "probe_name" text NOT NULL,
  "env" text NOT NULL,
  "status" text NOT NULL,
  "latency_ms" integer,
  "error_text" text,
  "screenshot_uri" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "synthetic_probe_results_env_check" CHECK (
    "env" IN ('dev', 'stag', 'live')
  ),
  CONSTRAINT "synthetic_probe_results_status_check" CHECK (
    "status" IN ('passed', 'failed', 'degraded')
  )
);
--> statement-breakpoint
ALTER TABLE "synthetic_probe_results" ADD CONSTRAINT "synthetic_probe_results_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "synthetic_probe_results_company_env_occurred_idx" ON "synthetic_probe_results" ("company_id", "env", "occurred_at");
--> statement-breakpoint
CREATE INDEX "synthetic_probe_results_probe_status_occurred_idx" ON "synthetic_probe_results" ("probe_name", "status", "occurred_at");
