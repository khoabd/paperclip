CREATE TABLE "rejection_clusters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "label" text,
  "category" text,
  "member_event_ids" uuid[] NOT NULL DEFAULT '{}',
  "centroid_embedding_id" uuid,
  "size" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'open',
  "auto_action" text,
  "escalated_to_intake_id" uuid,
  "last_recomputed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "rejection_clusters_status_check" CHECK (
    "status" IN ('open','escalated','resolved','dismissed')
  )
);
--> statement-breakpoint
ALTER TABLE "rejection_clusters" ADD CONSTRAINT "rejection_clusters_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "rejection_clusters" ADD CONSTRAINT "rejection_clusters_centroid_embedding_id_fk"
  FOREIGN KEY ("centroid_embedding_id") REFERENCES "entity_embeddings"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "rejection_clusters" ADD CONSTRAINT "rejection_clusters_escalated_to_intake_id_fk"
  FOREIGN KEY ("escalated_to_intake_id") REFERENCES "intake_items"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "rejection_clusters_company_status_recomputed_idx"
  ON "rejection_clusters" ("company_id", "status", "last_recomputed_at");
