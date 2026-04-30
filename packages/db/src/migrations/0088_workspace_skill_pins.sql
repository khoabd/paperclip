-- Custom Paperclip Phase 2.3: pin a workspace to a specific skill version.
-- Per Phase-2-Platform-Workspace-Mission-Layer §2.3.

CREATE TABLE IF NOT EXISTS "workspace_skill_pins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "skill_id" uuid NOT NULL REFERENCES "platform_skills"("id") ON DELETE CASCADE,
  "pinned_version" text NOT NULL,
  "reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_skill_pins_company_skill_uq"
  ON "workspace_skill_pins" ("company_id", "skill_id");
