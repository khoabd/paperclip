CREATE TABLE "sagas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'running',
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "outcome" text,
  "payload" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sagas_status_check" CHECK (
    "status" IN ('running', 'compensating', 'done', 'aborted')
  )
);
--> statement-breakpoint
ALTER TABLE "sagas" ADD CONSTRAINT "sagas_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "sagas_company_status_started_idx"
  ON "sagas" ("company_id", "status", "started_at");
