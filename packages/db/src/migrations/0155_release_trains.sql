-- Release trains per Phase-13-Release-Trains §train-builder.
-- Groups one or more feature keys that ship together. dryRun mode of the
-- TrainBuilder evaluates groupings without writing to this table; persisted
-- runs land here with mint=true and an issued tag.

CREATE TABLE IF NOT EXISTS "release_trains" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "tag" text NOT NULL,                            -- e.g. "train-2026-04-30-1"
  "feature_keys" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "rationale" text,
  "minted_at" timestamp with time zone NOT NULL DEFAULT now(),
  "minted_by" text                                -- "auto" | user id
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "release_trains_company_tag_idx"
  ON "release_trains" ("company_id", "tag");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "release_trains_minted_at_idx"
  ON "release_trains" ("minted_at");
