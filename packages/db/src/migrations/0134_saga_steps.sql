CREATE TABLE "saga_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "saga_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "forward_action" jsonb,
  "compensate_action" jsonb,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "error" text,
  CONSTRAINT "saga_steps_status_check" CHECK (
    "status" IN ('pending', 'running', 'done', 'failed', 'compensated')
  )
);
--> statement-breakpoint
ALTER TABLE "saga_steps" ADD CONSTRAINT "saga_steps_saga_id_fk"
  FOREIGN KEY ("saga_id") REFERENCES "sagas"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "saga_steps" ADD CONSTRAINT "saga_steps_saga_sequence_unique"
  UNIQUE ("saga_id", "sequence");
