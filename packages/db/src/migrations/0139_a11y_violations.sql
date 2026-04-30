CREATE TABLE "a11y_violations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "test_run_id" uuid NOT NULL,
  "rule_id" text NOT NULL,
  "impact" text NOT NULL,
  "target_selector" text NOT NULL,
  "html_snippet" text,
  "help_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "a11y_violations_impact_check" CHECK (
    "impact" IN ('minor', 'moderate', 'serious', 'critical')
  )
);
--> statement-breakpoint
ALTER TABLE "a11y_violations" ADD CONSTRAINT "a11y_violations_test_run_id_fk"
  FOREIGN KEY ("test_run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "a11y_violations_run_impact_idx"
  ON "a11y_violations" ("test_run_id", "impact");
