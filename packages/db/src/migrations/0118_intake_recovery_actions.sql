CREATE TABLE "intake_recovery_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "stage_id" uuid NOT NULL REFERENCES "greenfield_stages"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "attempt_number" integer NOT NULL DEFAULT 1,
  "action" jsonb NOT NULL DEFAULT '{}',
  "result" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "intake_recovery_actions_stage_idx" ON "intake_recovery_actions" ("stage_id", "occurred_at");
