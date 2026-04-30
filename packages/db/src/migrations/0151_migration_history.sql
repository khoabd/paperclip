CREATE TABLE "migration_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source" text NOT NULL,
  "target" text NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "records_migrated" integer DEFAULT 0 NOT NULL,
  "errors" jsonb NOT NULL DEFAULT '[]',
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "mh_target_status_started_idx" ON "migration_history" ("target", "status", "started_at");
