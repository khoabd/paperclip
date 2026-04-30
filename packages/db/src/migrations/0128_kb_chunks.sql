CREATE TABLE "kb_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "chunk_index" integer NOT NULL,
  "body" text NOT NULL,
  "symbol" text,
  "language" text,
  "embedding_id" uuid,
  "token_count" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "kb_chunks_document_chunk_unique" UNIQUE ("document_id", "chunk_index")
);
--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_document_id_fk"
  FOREIGN KEY ("document_id") REFERENCES "kb_documents"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_embedding_id_fk"
  FOREIGN KEY ("embedding_id") REFERENCES "entity_embeddings"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "kb_chunks_document_symbol_idx"
  ON "kb_chunks" ("document_id", "symbol");
