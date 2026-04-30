CREATE TABLE "cross_browser_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "test_run_id" uuid NOT NULL,
  "browser" text NOT NULL,
  "viewport" text NOT NULL,
  "screenshot_uri" text,
  "diff_pixel_count" integer,
  "baseline_id" uuid,
  "status" text NOT NULL DEFAULT 'passed',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cross_browser_results_status_check" CHECK (
    "status" IN ('passed', 'failed', 'new_baseline_needed')
  )
);
--> statement-breakpoint
ALTER TABLE "cross_browser_results" ADD CONSTRAINT "cross_browser_results_test_run_id_fk"
  FOREIGN KEY ("test_run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "cross_browser_results" ADD CONSTRAINT "cross_browser_results_baseline_id_fk"
  FOREIGN KEY ("baseline_id") REFERENCES "visual_baselines"("id") ON DELETE SET NULL;
