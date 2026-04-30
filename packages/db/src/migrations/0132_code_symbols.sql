CREATE TABLE "code_symbols" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "signature" text,
  "start_line" integer,
  "end_line" integer,
  "parent_symbol_id" uuid,
  "embedding_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "code_symbols_kind_check" CHECK (
    "kind" IN ('function','class','interface','type','enum','const')
  )
);
--> statement-breakpoint
ALTER TABLE "code_symbols" ADD CONSTRAINT "code_symbols_document_id_fk"
  FOREIGN KEY ("document_id") REFERENCES "kb_documents"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "code_symbols" ADD CONSTRAINT "code_symbols_parent_symbol_id_fk"
  FOREIGN KEY ("parent_symbol_id") REFERENCES "code_symbols"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "code_symbols" ADD CONSTRAINT "code_symbols_embedding_id_fk"
  FOREIGN KEY ("embedding_id") REFERENCES "entity_embeddings"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "code_symbols_document_kind_idx"
  ON "code_symbols" ("document_id", "kind");
