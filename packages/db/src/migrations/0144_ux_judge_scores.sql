CREATE TABLE "ux_judge_scores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "test_run_id" uuid NOT NULL,
  "dimension" text NOT NULL,
  "score" numeric(5, 2) NOT NULL,
  "reasoning" text,
  "screenshot_uri" text,
  "model" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ux_judge_scores_dimension_check" CHECK (
    "dimension" IN ('clarity', 'hierarchy', 'consistency', 'affordance', 'feedback', 'accessibility', 'delight')
  )
);
--> statement-breakpoint
ALTER TABLE "ux_judge_scores" ADD CONSTRAINT "ux_judge_scores_test_run_id_fk"
  FOREIGN KEY ("test_run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE;
