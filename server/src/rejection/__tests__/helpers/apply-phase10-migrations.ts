// Applies Phase-10 DDL directly to the test database.
// Required because migrations 0123-0125 are not yet in _journal.json
// (the orchestrator will append them after all parallel agents complete).
// Uses drizzle's db.$client (postgres-js instance) for raw SQL execution.

import { sql } from "drizzle-orm";
import type { createDb } from "@paperclipai/db";

export async function applyPhase10Tables(db: ReturnType<typeof createDb>): Promise<void> {
  // rejection_events
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "rejection_events" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "company_id" uuid NOT NULL,
      "approval_id" uuid,
      "mission_id" uuid,
      "intake_id" uuid,
      "category" text NOT NULL,
      "sub_category" text,
      "reason" text,
      "severity" integer,
      "embedding_id" uuid,
      "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'rejection_events_company_id_fk'
      ) THEN
        ALTER TABLE "rejection_events"
          ADD CONSTRAINT "rejection_events_company_id_fk"
          FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
      END IF;
    END $$
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'rejection_events_embedding_id_fk'
      ) THEN
        ALTER TABLE "rejection_events"
          ADD CONSTRAINT "rejection_events_embedding_id_fk"
          FOREIGN KEY ("embedding_id") REFERENCES "entity_embeddings"("id") ON DELETE SET NULL;
      END IF;
    END $$
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "rejection_events_company_category_occurred_idx"
      ON "rejection_events" ("company_id", "category", "occurred_at")
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "rejection_events_approval_idx"
      ON "rejection_events" ("approval_id")
  `);

  // rejection_clusters
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "rejection_clusters" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "company_id" uuid NOT NULL,
      "label" text,
      "category" text,
      "member_event_ids" uuid[] NOT NULL DEFAULT '{}',
      "centroid_embedding_id" uuid,
      "size" integer NOT NULL DEFAULT 0,
      "status" text NOT NULL DEFAULT 'open',
      "auto_action" text,
      "escalated_to_intake_id" uuid,
      "last_recomputed_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'rejection_clusters_company_id_fk'
      ) THEN
        ALTER TABLE "rejection_clusters"
          ADD CONSTRAINT "rejection_clusters_company_id_fk"
          FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
      END IF;
    END $$
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'rejection_clusters_escalated_to_intake_id_fk'
      ) THEN
        ALTER TABLE "rejection_clusters"
          ADD CONSTRAINT "rejection_clusters_escalated_to_intake_id_fk"
          FOREIGN KEY ("escalated_to_intake_id") REFERENCES "intake_items"("id") ON DELETE SET NULL;
      END IF;
    END $$
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "rejection_clusters_company_status_recomputed_idx"
      ON "rejection_clusters" ("company_id", "status", "last_recomputed_at")
  `);

  // rejection_taxonomy
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "rejection_taxonomy" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "category" text NOT NULL,
      "sub_category" text,
      "description" text,
      "default_severity" integer,
      "recommended_action" text,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "rejection_taxonomy_category_unique" UNIQUE ("category")
    )
  `);
}
