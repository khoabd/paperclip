-- Custom Paperclip Phase 5.1: timeline estimates per intake (L1/L2/L3).
-- L2/L3 populators land in later phases; schema is here so writers can land alongside.
-- Per Phase-5-Human-Intake-Hub §5.1.

CREATE TABLE IF NOT EXISTS "intake_timeline_estimates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intake_id" uuid NOT NULL REFERENCES "intake_items"("id") ON DELETE CASCADE,
  "level" text NOT NULL,
  "p50_days" numeric(8,2),
  "p90_days" numeric(8,2),
  "source" text NOT NULL,
  "rationale" text,
  "computed_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_timeline_estimates_intake_level_idx"
  ON "intake_timeline_estimates" ("intake_id", "level", "computed_at");
