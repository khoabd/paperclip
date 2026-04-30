CREATE TABLE "rejection_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "approval_id" uuid,
  "mission_id" uuid,
  "intake_id" uuid,
  "category" text NOT NULL,
  "sub_category" text,
  "reason" text,
  "severity" integer,
  "embedding_id" uuid,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "rejection_events_category_check" CHECK (
    "category" IN (
      'wrong_scope','missing_context','spec_violation','design_conflict',
      'tech_debt','security','performance','accessibility','i18n',
      'test_gap','docs_gap','cost','timeline','other'
    )
  )
);
--> statement-breakpoint
ALTER TABLE "rejection_events" ADD CONSTRAINT "rejection_events_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "rejection_events" ADD CONSTRAINT "rejection_events_approval_id_fk"
  FOREIGN KEY ("approval_id") REFERENCES "approvals"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "rejection_events" ADD CONSTRAINT "rejection_events_mission_id_fk"
  FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "rejection_events" ADD CONSTRAINT "rejection_events_intake_id_fk"
  FOREIGN KEY ("intake_id") REFERENCES "intake_items"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "rejection_events" ADD CONSTRAINT "rejection_events_embedding_id_fk"
  FOREIGN KEY ("embedding_id") REFERENCES "entity_embeddings"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "rejection_events_company_category_occurred_idx"
  ON "rejection_events" ("company_id", "category", "occurred_at");
--> statement-breakpoint
CREATE INDEX "rejection_events_approval_idx"
  ON "rejection_events" ("approval_id");
