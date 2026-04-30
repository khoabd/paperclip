CREATE TABLE "fuzz_run_summaries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "test_run_id" uuid NOT NULL,
  "target" text NOT NULL,
  "total_runs" integer NOT NULL,
  "failures" integer NOT NULL,
  "shrunk_failures" integer NOT NULL,
  "seed" text,
  "summary" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fuzz_run_summaries" ADD CONSTRAINT "fuzz_run_summaries_test_run_id_fk"
  FOREIGN KEY ("test_run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE;
