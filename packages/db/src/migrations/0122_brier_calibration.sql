CREATE TABLE "brier_calibration" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope" text NOT NULL,
  "scope_id" text NOT NULL,
  "window_days" integer NOT NULL,
  "n" integer NOT NULL,
  "brier_score" numeric(8,6) NOT NULL,
  "mean_confidence" numeric(5,4),
  "mean_outcome" numeric(5,4),
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "brier_calibration_scope_id_computed_idx" ON "brier_calibration" ("scope", "scope_id", "computed_at");
--> statement-breakpoint
CREATE INDEX "brier_calibration_scope_window_idx" ON "brier_calibration" ("scope", "scope_id", "window_days");
