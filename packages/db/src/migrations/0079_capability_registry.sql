-- Custom Paperclip Phase 2.1: capability registry (platform-singleton).
-- Per Phase-2-Platform-Workspace-Mission-Layer §2.1.

CREATE TABLE IF NOT EXISTS "capability_registry" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "default_mode" text NOT NULL DEFAULT 'sandbox',
  "risk_tier" text NOT NULL DEFAULT 'low',
  "brier_window_days" integer NOT NULL DEFAULT 30,
  "owner" text,
  "description" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "capability_registry_name_uq" ON "capability_registry" ("name");
