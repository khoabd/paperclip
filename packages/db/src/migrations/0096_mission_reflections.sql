-- Custom Paperclip Phase 4.1: append-only reflections from the strategic loop.
-- Per Phase-4-Strategic-Loop-Foundation §4.1.

CREATE TABLE IF NOT EXISTS "mission_reflections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mission_id" uuid NOT NULL REFERENCES "missions"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "body" text NOT NULL,
  "tags" text[] NOT NULL DEFAULT '{}'::text[],
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mission_reflections_mission_created_idx" ON "mission_reflections" ("mission_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mission_reflections_kind_idx" ON "mission_reflections" ("kind");
