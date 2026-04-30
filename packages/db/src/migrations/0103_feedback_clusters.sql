-- Custom Paperclip Phase 5.1: feedback clusters table (schema-only this phase).
-- Populator (DBSCAN) lands in Phase 10. We land the schema here so writers/readers can be tested.
-- Per Phase-5-Human-Intake-Hub §5.1 + Phase-10 plan.

CREATE TABLE IF NOT EXISTS "feedback_clusters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "cluster_size" integer NOT NULL DEFAULT 0,
  "theme" text,
  "centroid_intake_id" uuid REFERENCES "intake_items"("id") ON DELETE SET NULL,
  "member_intake_ids" uuid[] NOT NULL DEFAULT '{}'::uuid[],
  "promoted_to_intake_id" uuid REFERENCES "intake_items"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'open',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_clusters_company_status_idx"
  ON "feedback_clusters" ("company_id", "status");
