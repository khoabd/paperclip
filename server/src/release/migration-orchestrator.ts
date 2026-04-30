// MigrationOrchestrator — Phase 15 §Services.3
//
// Pure persistence service for tracking paperclip → custom-paperclip migration runs.
// Actual migration logic lives in standalone scripts outside this phase.
//
// Lifecycle: start → recordProgress (N times) → complete

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { migrationHistory } from "@paperclipai/db/schema/migration_history";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MigrationKind =
  | "paperclip_company_to_workspace"
  | "paperclip_issue_to_mission"
  | "capability_seed"
  | "template_install";

export type MigrationStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "rolled_back";

export interface StartMigrationInput {
  source: string;
  target: string;
  kind: MigrationKind | string;
  /** Optional structured plan stored as first entry in errors (repurposed as metadata) */
  plan?: Record<string, unknown>;
}

export interface MigrationRow {
  id: string;
  source: string;
  target: string;
  kind: string;
  status: string;
  recordsMigrated: number;
  errors: unknown[];
  startedAt: Date;
  finishedAt: Date | null;
}

// ---------------------------------------------------------------------------
// MigrationOrchestrator
// ---------------------------------------------------------------------------

export class MigrationOrchestrator {
  constructor(private readonly db: Db) {}

  /** Open a new migration_history row; status starts as 'running'. */
  async start(input: StartMigrationInput): Promise<MigrationRow> {
    const errors: unknown[] = input.plan ? [{ type: "plan", data: input.plan }] : [];

    const [row] = await this.db
      .insert(migrationHistory)
      .values({
        source: input.source,
        target: input.target,
        kind: input.kind,
        status: "running",
        recordsMigrated: 0,
        errors,
      })
      .returning();

    return this.toRow(row);
  }

  /** Increment the records_migrated counter by `count`. */
  async recordProgress(id: string, count: number): Promise<void> {
    const [current] = await this.db
      .select({ recordsMigrated: migrationHistory.recordsMigrated })
      .from(migrationHistory)
      .where(eq(migrationHistory.id, id));

    if (!current) throw new Error(`MigrationOrchestrator: row ${id} not found`);

    await this.db
      .update(migrationHistory)
      .set({ recordsMigrated: (current.recordsMigrated ?? 0) + count })
      .where(eq(migrationHistory.id, id));
  }

  /** Append an error entry to the errors array. */
  async recordError(id: string, error: unknown): Promise<void> {
    const [current] = await this.db
      .select({ errors: migrationHistory.errors })
      .from(migrationHistory)
      .where(eq(migrationHistory.id, id));

    if (!current) throw new Error(`MigrationOrchestrator: row ${id} not found`);

    const existing = (current.errors as unknown[]) ?? [];
    await this.db
      .update(migrationHistory)
      .set({ errors: [...existing, error] })
      .where(eq(migrationHistory.id, id));
  }

  /** Finalize the migration row with a terminal status. */
  async complete(id: string, status: "completed" | "failed" | "rolled_back"): Promise<MigrationRow> {
    const [row] = await this.db
      .update(migrationHistory)
      .set({ status, finishedAt: new Date() })
      .where(eq(migrationHistory.id, id))
      .returning();

    if (!row) throw new Error(`MigrationOrchestrator: row ${id} not found`);
    return this.toRow(row);
  }

  /** Fetch a migration row by id. */
  async get(id: string): Promise<MigrationRow | null> {
    const [row] = await this.db
      .select()
      .from(migrationHistory)
      .where(eq(migrationHistory.id, id));

    return row ? this.toRow(row) : null;
  }

  private toRow(row: typeof migrationHistory.$inferSelect): MigrationRow {
    return {
      id: row.id,
      source: row.source,
      target: row.target,
      kind: row.kind,
      status: row.status,
      recordsMigrated: row.recordsMigrated ?? 0,
      errors: (row.errors as unknown[]) ?? [],
      startedAt: row.startedAt,
      finishedAt: row.finishedAt ?? null,
    };
  }
}
