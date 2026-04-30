-- Custom Paperclip Phase 0 corrective: add `key` column to documents
-- Per ADR-0007 (Brain storage uses documents with key='brain') + Mismapping Fix §7.1.
-- Additive change — existing rows keep key=NULL.

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "documents_company_key_idx" ON "documents" ("company_id", "key");
