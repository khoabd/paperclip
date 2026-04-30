CREATE TABLE "agent_uncertainty_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "mission_id" uuid REFERENCES "missions"("id") ON DELETE SET NULL,
  "kind" text NOT NULL,
  "observed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'
);
--> statement-breakpoint
CREATE INDEX "agent_uncertainty_events_agent_kind_obs_idx" ON "agent_uncertainty_events" ("agent_id", "kind", "observed_at");
