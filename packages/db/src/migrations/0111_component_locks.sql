-- Custom Paperclip Phase 7.1: component locks prevent concurrent design modifications.
-- Unique constraint on (company_id, project_id, component_path) enforces single owner.
-- Per Phase-7-Development-Flow-Feature-Flags §7.1.

CREATE TABLE IF NOT EXISTS "component_locks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "component_path" text NOT NULL,
  "locked_by_design_doc_id" uuid REFERENCES "design_docs"("id") ON DELETE SET NULL,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "component_locks_owner_idx"
  ON "component_locks" ("company_id", "project_id", "component_path");
