CREATE TABLE "kb_doc_staleness" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "score" numeric(5,4) NOT NULL,
  "reason" text,
  "last_check_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "kb_doc_staleness_document_unique" UNIQUE ("document_id")
);
--> statement-breakpoint
ALTER TABLE "kb_doc_staleness" ADD CONSTRAINT "kb_doc_staleness_document_id_fk"
  FOREIGN KEY ("document_id") REFERENCES "kb_documents"("id") ON DELETE CASCADE;
