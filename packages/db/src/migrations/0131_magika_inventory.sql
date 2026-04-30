CREATE TABLE "magika_inventory" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "repo_id" uuid NOT NULL,
  "file_path" text NOT NULL,
  "magika_label" text NOT NULL,
  "confidence" numeric(5,4) NOT NULL,
  "is_vendored" boolean NOT NULL DEFAULT false,
  "is_generated" boolean NOT NULL DEFAULT false,
  "is_binary" boolean NOT NULL DEFAULT false,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "magika_inventory_repo_path_unique" UNIQUE ("repo_id", "file_path")
);
--> statement-breakpoint
ALTER TABLE "magika_inventory" ADD CONSTRAINT "magika_inventory_repo_id_fk"
  FOREIGN KEY ("repo_id") REFERENCES "kb_repositories"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "magika_inventory_repo_label_idx"
  ON "magika_inventory" ("repo_id", "magika_label");
