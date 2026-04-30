CREATE TABLE IF NOT EXISTS "document_embeddings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "model" text NOT NULL DEFAULT 'nomic-embed-text',
  "chunk_index" integer NOT NULL DEFAULT 0,
  "chunk_text" text NOT NULL,
  "embedding" real[] NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "doc_embeddings_document_idx" ON "document_embeddings" ("document_id");
CREATE INDEX IF NOT EXISTS "doc_embeddings_company_idx" ON "document_embeddings" ("company_id");
