-- Custom Paperclip Phase 2.3: append-only lifecycle log per workspace.
-- Per Phase-2-Platform-Workspace-Mission-Layer §2.3.

CREATE TABLE IF NOT EXISTS "workspace_lifecycle_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "actor_user_id" text,
  "actor_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_lifecycle_company_occurred_idx"
  ON "workspace_lifecycle_events" ("company_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_lifecycle_kind_idx"
  ON "workspace_lifecycle_events" ("kind");
