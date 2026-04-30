CREATE TABLE "rejection_taxonomy" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "category" text NOT NULL,
  "sub_category" text,
  "description" text,
  "default_severity" integer,
  "recommended_action" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "rejection_taxonomy_category_unique" UNIQUE ("category")
);
--> statement-breakpoint
INSERT INTO "rejection_taxonomy" ("category", "sub_category", "description", "default_severity", "recommended_action") VALUES
  ('wrong_scope',      NULL,             'Proposal scope is too broad or too narrow for the current context', 2, 'adjust_prompt'),
  ('missing_context',  NULL,             'Required context was absent — agent lacked data to produce correct output', 2, 'notify'),
  ('spec_violation',   NULL,             'Output violates explicit specification or acceptance criteria', 3, 'tighten_qa'),
  ('design_conflict',  NULL,             'Proposal conflicts with existing architecture or design principles', 3, 'adjust_principle'),
  ('tech_debt',        NULL,             'Introduces unacceptable technical debt without mitigation plan', 2, 'notify'),
  ('security',         'auth',           'Security vulnerability in authentication/authorization layer', 4, 'tighten_security'),
  ('security',         'injection',      'Injection risk (SQL, shell, template) detected', 4, 'tighten_security'),
  ('security',         'supply_chain',   'Supply-chain or dependency risk', 3, 'tighten_security'),
  ('performance',      NULL,             'Unacceptable performance regression or algorithmic complexity', 2, 'notify'),
  ('accessibility',    NULL,             'Fails accessibility standards (WCAG 2.1 AA or above)', 2, 'tighten_qa'),
  ('i18n',             NULL,             'Missing or broken internationalisation / localisation support', 1, 'notify'),
  ('test_gap',         NULL,             'Insufficient test coverage for proposed change', 2, 'tighten_qa'),
  ('docs_gap',         NULL,             'Documentation is missing or inadequate for the change', 1, 'notify'),
  ('cost',             NULL,             'Estimated or actual cost exceeds acceptable threshold', 3, 'adjust_velocity'),
  ('timeline',         NULL,             'Timeline estimate is unrealistic or conflicts with roadmap', 2, 'adjust_velocity'),
  ('other',            'meta_repeat',    'Same component or feature repeatedly fails — escalate for human strategy', 4, 'escalate_to_intake'),
  ('other',            NULL,             'Free-form rejection requiring manual review', 1, 'notify')
ON CONFLICT ("category") DO NOTHING;
