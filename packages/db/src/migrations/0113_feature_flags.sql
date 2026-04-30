-- Custom Paperclip Phase 7.1: feature flags with workspace-scoped ownership.
-- Status: off | canary | on. off = always disabled, on = always enabled, canary = percent-gated.
-- Per Phase-7-Development-Flow-Feature-Flags §7.1.

CREATE TABLE IF NOT EXISTS "feature_flags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "key" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'off',
  "rollout_percent" integer NOT NULL DEFAULT 0,
  "owner_user_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_company_key_idx"
  ON "feature_flags" ("company_id", "key");
