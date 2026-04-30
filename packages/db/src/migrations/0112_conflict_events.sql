-- Custom Paperclip Phase 7.1: conflict events between design documents.
-- Kinds: schema | api | ui | behavior.
-- Per Phase-7-Development-Flow-Feature-Flags §7.1.

CREATE TABLE IF NOT EXISTS "conflict_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "design_doc_a_id" uuid REFERENCES "design_docs"("id") ON DELETE SET NULL,
  "design_doc_b_id" uuid REFERENCES "design_docs"("id") ON DELETE SET NULL,
  "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "detected_at" timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at" timestamp with time zone,
  "resolution_notes" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conflict_events_company_kind_idx"
  ON "conflict_events" ("company_id", "kind", "detected_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conflict_events_open_idx"
  ON "conflict_events" ("company_id", "detected_at") WHERE "resolved_at" IS NULL;
