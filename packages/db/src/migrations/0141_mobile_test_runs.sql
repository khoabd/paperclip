CREATE TABLE "mobile_test_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "test_run_id" uuid NOT NULL,
  "platform" text NOT NULL,
  "device_model" text NOT NULL,
  "os_version" text NOT NULL,
  "screenshot_uri" text,
  "video_uri" text,
  "status" text NOT NULL DEFAULT 'passed',
  "appium_session_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mobile_test_runs_platform_check" CHECK (
    "platform" IN ('ios', 'android')
  ),
  CONSTRAINT "mobile_test_runs_status_check" CHECK (
    "status" IN ('passed', 'failed', 'errored')
  )
);
--> statement-breakpoint
ALTER TABLE "mobile_test_runs" ADD CONSTRAINT "mobile_test_runs_test_run_id_fk"
  FOREIGN KEY ("test_run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE;
