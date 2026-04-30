-- Custom Paperclip Phase 7.1: design document lifecycle management.
-- Tracks design docs from proposal through live/archived.
-- Per Phase-7-Development-Flow-Feature-Flags §7.1.

CREATE TABLE IF NOT EXISTS "design_docs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "key" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'proposed',
  "conflicts_with" uuid[] NOT NULL DEFAULT '{}'::uuid[],
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "design_docs_company_key_idx"
  ON "design_docs" ("company_id", "key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "design_docs_company_status_idx"
  ON "design_docs" ("company_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "design_docs_project_status_idx"
  ON "design_docs" ("project_id", "status");
