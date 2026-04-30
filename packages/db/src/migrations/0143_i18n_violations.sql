CREATE TABLE "i18n_violations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "test_run_id" uuid NOT NULL,
  "locale" text NOT NULL,
  "kind" text NOT NULL,
  "target_selector" text NOT NULL,
  "expected_text" text,
  "actual_text" text,
  "severity" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "i18n_violations_kind_check" CHECK (
    "kind" IN ('untranslated', 'truncation', 'date_format', 'number_format', 'rtl_overlap', 'pluralization')
  ),
  CONSTRAINT "i18n_violations_severity_check" CHECK (
    "severity" IN ('minor', 'moderate', 'serious', 'critical')
  )
);
--> statement-breakpoint
ALTER TABLE "i18n_violations" ADD CONSTRAINT "i18n_violations_test_run_id_fk"
  FOREIGN KEY ("test_run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE;
