CREATE TABLE "visual_baselines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "route" text NOT NULL,
  "viewport" text NOT NULL,
  "browser" text NOT NULL,
  "image_uri" text NOT NULL,
  "sha" text NOT NULL,
  "approved_at" timestamp with time zone,
  "approved_by_user_id" text,
  "archived" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visual_baselines" ADD CONSTRAINT "visual_baselines_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX "visual_baselines_active_unique_idx"
  ON "visual_baselines" ("company_id", "route", "viewport", "browser")
  WHERE "archived" = false;
