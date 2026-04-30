-- Custom Paperclip Phase 2.2: workspace primitives on companies (per ADR-0006).
-- Per Phase-2-Platform-Workspace-Mission-Layer §2.2.

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "autonomy_level" text NOT NULL DEFAULT 'sandbox';
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "wfq_weight" integer NOT NULL DEFAULT 100;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "cost_budget_usd_per_week" numeric(12,4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "rag_namespace" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "vault_path" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "pg_schema" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "companies_autonomy_level_idx" ON "companies" ("autonomy_level");
