CREATE TABLE "greenfield_intakes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "idea_title" text NOT NULL,
  "idea_text" text NOT NULL,
  "submitter_user_id" text,
  "status" text NOT NULL DEFAULT 'pending',
  "total_cost_usd" numeric(10,4),
  "wall_clock_ms" bigint,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "greenfield_intakes_company_status_created_idx" ON "greenfield_intakes" ("company_id", "status", "created_at");
