CREATE TABLE "decision_class_lookup" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "reversibility" text NOT NULL,
  "blast_radius" text NOT NULL,
  "default_threshold" numeric(5,4) NOT NULL,
  "default_pattern" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "decision_class_lookup_kind_rev_blast_uidx" ON "decision_class_lookup" ("kind", "reversibility", "blast_radius");
--> statement-breakpoint
CREATE INDEX "decision_class_lookup_kind_idx" ON "decision_class_lookup" ("kind");
--> statement-breakpoint
-- Seed: idempotent INSERTs for the Reversibility × Blast-Radius matrix (generic kind)
-- Base thresholds per Decision-Boundary-and-Uncertainty-Model §4 + Phase 9 spec
INSERT INTO "decision_class_lookup" ("kind","reversibility","blast_radius","default_threshold","default_pattern","notes")
VALUES
  ('generic','easy','local',         0.6500,'code_change',   'easy × local → low bar'),
  ('generic','easy','workspace',     0.6500,'code_change',   'easy × workspace → low bar'),
  ('generic','easy','company',       0.7500,'code_change',   'easy × company → medium bar'),
  ('generic','easy','global',        0.7500,'external_action','easy × global → medium bar'),
  ('generic','hard','local',         0.7800,'code_change',   'hard × local → elevated bar'),
  ('generic','hard','workspace',     0.7800,'external_action','hard × workspace → elevated bar'),
  ('generic','hard','company',       0.8500,'external_action','hard × company → high bar'),
  ('generic','hard','global',        0.9200,'policy_exception','hard × global → very high bar'),
  ('generic','irreversible','local',         0.8000,'external_action','irreversible × local → strict'),
  ('generic','irreversible','workspace',     0.9000,'external_action','irreversible × workspace → very strict'),
  ('generic','irreversible','company',       0.9500,'policy_exception','irreversible × company → near-certain'),
  ('generic','irreversible','global',        0.9900,'policy_exception','irreversible × global → near-certain required')
ON CONFLICT ("kind","reversibility","blast_radius") DO NOTHING;
--> statement-breakpoint
-- Concrete-kind overrides
INSERT INTO "decision_class_lookup" ("kind","reversibility","blast_radius","default_threshold","default_pattern","notes")
VALUES
  ('migration',        'hard',         'workspace', 0.9000,'external_action','DB migration — always high bar'),
  ('migration',        'irreversible',  'company',   0.9700,'policy_exception','Destructive migration — near certain'),
  ('deploy',           'hard',         'company',   0.8800,'external_action','Production deploy gate'),
  ('deploy',           'hard',         'global',    0.9500,'policy_exception','Global deploy gate'),
  ('policy_exception', 'hard',         'company',   0.9800,'policy_exception','Policy override — very high bar'),
  ('policy_exception', 'irreversible',  'global',    0.9900,'policy_exception','Global policy exception — max bar'),
  ('data_export',      'hard',         'company',   0.9000,'data_export',    'Data export with company scope'),
  ('cost_burst',       'hard',         'workspace', 0.8500,'cost_burst',     'Large unexpected cost spike')
ON CONFLICT ("kind","reversibility","blast_radius") DO NOTHING;
