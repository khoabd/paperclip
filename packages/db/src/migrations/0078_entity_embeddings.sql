-- Custom Paperclip Phase 1: generic entity-typed embedding store.
-- Per Phase-1-External-Integrations §2.3.
-- Superset of document_embeddings (kept for backwards compat).

CREATE TABLE IF NOT EXISTS "entity_embeddings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "chunk_index" integer NOT NULL DEFAULT 0,
  "chunk_text" text NOT NULL,
  "model" text NOT NULL DEFAULT 'text-embedding-3-small',
  "embedding" real[] NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_embeddings_company_entity_idx" ON "entity_embeddings" ("company_id", "entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_embeddings_company_type_created_idx" ON "entity_embeddings" ("company_id", "entity_type", "created_at");
