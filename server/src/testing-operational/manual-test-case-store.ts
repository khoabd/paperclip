// ManualTestCaseStore — Phase 14c §Services.4
//
// CRUD + state-machine transitions for manual_test_cases.
// State machine: pending → in_progress → passed | failed | skipped
// Invalid transitions throw a typed error.

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { manualTestCases } from "@paperclipai/db/schema/manual_test_cases";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ManualTCStatus =
  | "pending"
  | "in_progress"
  | "passed"
  | "failed"
  | "skipped";

export type ManualTCDimension = "manual_tc" | "persona" | "exploratory";

export interface CreateManualTCInput {
  companyId: string;
  missionId?: string;
  title: string;
  body?: string;
  dimension: ManualTCDimension;
  createdByUserId?: string;
}

export interface ManualTCRow {
  id: string;
  companyId: string;
  missionId: string | null;
  title: string;
  body: string | null;
  assignedToUserId: string | null;
  status: ManualTCStatus;
  result: string | null;
  evidenceUri: string | null;
  dimension: string;
  createdByUserId: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export class ManualTCTransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Invalid transition: ${from} → ${to}`);
    this.name = "ManualTCTransitionError";
  }
}

// ---------------------------------------------------------------------------
// State machine allowed transitions
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<ManualTCStatus, ManualTCStatus[]> = {
  pending: ["in_progress", "skipped"],
  in_progress: ["passed", "failed", "skipped"],
  passed: [],
  failed: [],
  skipped: [],
};

function assertTransition(from: ManualTCStatus, to: ManualTCStatus): void {
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new ManualTCTransitionError(from, to);
  }
}

// ---------------------------------------------------------------------------
// ManualTestCaseStore
// ---------------------------------------------------------------------------

export class ManualTestCaseStore {
  constructor(private readonly db: Db) {}

  /** Create a new manual test case in status=pending. */
  async create(input: CreateManualTCInput): Promise<ManualTCRow> {
    const [row] = await this.db
      .insert(manualTestCases)
      .values({
        companyId: input.companyId,
        missionId: input.missionId ?? null,
        title: input.title,
        body: input.body ?? null,
        dimension: input.dimension,
        createdByUserId: input.createdByUserId ?? null,
        status: "pending",
      })
      .returning();

    return this.mapRow(row);
  }

  /**
   * Assign the test case to a user and transition pending → in_progress.
   * Throws ManualTCTransitionError if the current status is not pending.
   */
  async assign(id: string, userId: string): Promise<ManualTCRow> {
    const current = await this.fetch(id);
    assertTransition(current.status, "in_progress");

    const [row] = await this.db
      .update(manualTestCases)
      .set({ assignedToUserId: userId, status: "in_progress" })
      .where(eq(manualTestCases.id, id))
      .returning();

    return this.mapRow(row);
  }

  /**
   * Submit a result and transition in_progress → passed | failed | skipped.
   * Also accepts pending → skipped directly.
   * Throws ManualTCTransitionError for invalid transitions.
   */
  async submitResult(
    id: string,
    result: "passed" | "failed" | "skipped",
    evidenceUri?: string,
  ): Promise<ManualTCRow> {
    const current = await this.fetch(id);
    assertTransition(current.status, result);

    const [row] = await this.db
      .update(manualTestCases)
      .set({
        status: result,
        result,
        evidenceUri: evidenceUri ?? null,
        completedAt: new Date(),
      })
      .where(eq(manualTestCases.id, id))
      .returning();

    return this.mapRow(row);
  }

  /** Fetch a single row; throws if not found. */
  async fetch(id: string): Promise<ManualTCRow> {
    const rows = await this.db
      .select()
      .from(manualTestCases)
      .where(eq(manualTestCases.id, id));

    if (rows.length === 0) {
      throw new Error(`ManualTestCase not found: ${id}`);
    }

    return this.mapRow(rows[0]);
  }

  /** List all test cases for a company. */
  async listByCompany(companyId: string): Promise<ManualTCRow[]> {
    const rows = await this.db
      .select()
      .from(manualTestCases)
      .where(eq(manualTestCases.companyId, companyId));

    return rows.map((r) => this.mapRow(r));
  }

  // ---------------------------------------------------------------------------

  private mapRow(row: typeof manualTestCases.$inferSelect): ManualTCRow {
    return {
      id: row.id,
      companyId: row.companyId,
      missionId: row.missionId ?? null,
      title: row.title,
      body: row.body ?? null,
      assignedToUserId: row.assignedToUserId ?? null,
      status: row.status as ManualTCStatus,
      result: row.result ?? null,
      evidenceUri: row.evidenceUri ?? null,
      dimension: row.dimension,
      createdByUserId: row.createdByUserId ?? null,
      createdAt: row.createdAt,
      completedAt: row.completedAt ?? null,
    };
  }
}
