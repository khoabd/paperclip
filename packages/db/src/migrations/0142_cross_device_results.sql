CREATE TABLE "cross_device_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "test_run_id" uuid NOT NULL,
  "device_class" text NOT NULL,
  "viewport" text NOT NULL,
  "browser" text NOT NULL,
  "screenshot_uri" text,
  "status" text NOT NULL DEFAULT 'passed',
  "diff_pixel_count" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cross_device_results_device_class_check" CHECK (
    "device_class" IN ('mobile', 'tablet', 'desktop', 'wide_desktop')
  ),
  CONSTRAINT "cross_device_results_status_check" CHECK (
    "status" IN ('passed', 'failed', 'errored')
  )
);
--> statement-breakpoint
ALTER TABLE "cross_device_results" ADD CONSTRAINT "cross_device_results_test_run_id_fk"
  FOREIGN KEY ("test_run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "cross_device_results_run_class_idx"
  ON "cross_device_results" ("test_run_id", "device_class");
