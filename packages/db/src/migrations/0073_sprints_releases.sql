CREATE TABLE IF NOT EXISTS "sprints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "goal" text,
  "status" text NOT NULL DEFAULT 'planning',
  "start_date" timestamp with time zone,
  "end_date" timestamp with time zone,
  "velocity" integer,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "sprint_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sprint_id" uuid NOT NULL REFERENCES "sprints"("id") ON DELETE CASCADE,
  "issue_id" uuid NOT NULL,
  "added_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "releases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "sprint_id" uuid REFERENCES "sprints"("id") ON DELETE SET NULL,
  "version" text NOT NULL,
  "name" text,
  "notes" text,
  "status" text NOT NULL DEFAULT 'draft',
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "sprints_company_idx" ON "sprints" ("company_id");
CREATE INDEX IF NOT EXISTS "sprints_project_idx" ON "sprints" ("project_id");
CREATE INDEX IF NOT EXISTS "sprint_issues_sprint_idx" ON "sprint_issues" ("sprint_id");
CREATE INDEX IF NOT EXISTS "sprint_issues_issue_idx" ON "sprint_issues" ("issue_id");
CREATE INDEX IF NOT EXISTS "releases_company_idx" ON "releases" ("company_id");
CREATE INDEX IF NOT EXISTS "releases_project_idx" ON "releases" ("project_id");
CREATE INDEX IF NOT EXISTS "releases_sprint_idx" ON "releases" ("sprint_id");
