-- Custom Paperclip Phase 2.1: cross-workspace pattern store (no company_id).
-- Per Phase-2-Platform-Workspace-Mission-Layer §2.1.

CREATE TABLE IF NOT EXISTS "cross_workspace_learning" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "key" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "observed_count" integer NOT NULL DEFAULT 1,
  "first_observed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_observed_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cross_workspace_learning_kind_key_uq" ON "cross_workspace_learning" ("kind", "key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cross_workspace_learning_kind_idx" ON "cross_workspace_learning" ("kind", "observed_count");
