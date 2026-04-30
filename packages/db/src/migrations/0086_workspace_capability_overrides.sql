-- Custom Paperclip Phase 2.3: per-workspace capability mode overrides.
-- Per Phase-2-Platform-Workspace-Mission-Layer §2.3.

CREATE TABLE IF NOT EXISTS "workspace_capability_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "capability_id" uuid NOT NULL REFERENCES "capability_registry"("id") ON DELETE CASCADE,
  "mode" text NOT NULL,
  "override_reason" text,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_capability_overrides_company_cap_uq"
  ON "workspace_capability_overrides" ("company_id", "capability_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_capability_overrides_company_idx"
  ON "workspace_capability_overrides" ("company_id");
