-- Custom Paperclip Phase 5.1: Human Intake Hub — root intake row.
-- Per Phase-5-Human-Intake-Hub §5.1.

CREATE TABLE IF NOT EXISTS "intake_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "priority" text,
  "state" text NOT NULL DEFAULT 'triaged',
  "submitter_user_id" text,
  "submitter_mood" integer,
  "raw_text" text NOT NULL,
  "title" text,
  "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "classified_type_conf" numeric(5,4),
  "linked_release_tag" text,
  "linked_feature_key" text,
  "duplicate_of" uuid REFERENCES "intake_items"("id") ON DELETE SET NULL,
  "mission_id" uuid REFERENCES "missions"("id") ON DELETE SET NULL,
  "source" text NOT NULL DEFAULT 'human_console',
  "source_ref" text,
  "spec" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_items_company_state_idx"
  ON "intake_items" ("company_id", "state")
  WHERE "closed_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_items_company_type_created_idx"
  ON "intake_items" ("company_id", "type", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_items_mission_idx"
  ON "intake_items" ("mission_id")
  WHERE "mission_id" IS NOT NULL;
