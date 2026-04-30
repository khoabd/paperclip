CREATE TABLE "greenfield_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intake_id" uuid NOT NULL REFERENCES "greenfield_intakes"("id") ON DELETE CASCADE,
  "stage_name" text NOT NULL,
  "sequence" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "inputs" jsonb NOT NULL DEFAULT '{}',
  "outputs" jsonb NOT NULL DEFAULT '{}',
  "gate_approval_id" uuid REFERENCES "approvals"("id") ON DELETE SET NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "error" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "greenfield_stages_intake_seq_uidx" ON "greenfield_stages" ("intake_id", "sequence");
--> statement-breakpoint
CREATE INDEX "greenfield_stages_intake_status_idx" ON "greenfield_stages" ("intake_id", "status");
