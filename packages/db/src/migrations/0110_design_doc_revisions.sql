-- Custom Paperclip Phase 7.1: version history for design documents.
-- Each body change writes a new revision row; revision_number is monotonic per doc.
-- Per Phase-7-Development-Flow-Feature-Flags §7.1.

CREATE TABLE IF NOT EXISTS "design_doc_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "design_doc_id" uuid NOT NULL REFERENCES "design_docs"("id") ON DELETE CASCADE,
  "revision_number" integer NOT NULL,
  "body" text NOT NULL,
  "change_summary" text,
  "created_by_user_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "design_doc_revisions_doc_rev_idx"
  ON "design_doc_revisions" ("design_doc_id", "revision_number");
