// TestRunStore — pure persistence layer for test_runs rows.
// Phase 14a §Services.1.

import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { testRuns } from "@paperclipai/db/schema/test_runs";

export interface CreateTestRunInput {
  companyId: string;
  missionId?: string | null;
  prRef?: string | null;
  /** visual | a11y | cross_browser | mobile | i18n | ux_judge | fuzz | persona_e2e | synthetic | manual_tc */
  dimension: string;
}

export interface TestRunRow {
  id: string;
  companyId: string;
  missionId: string | null;
  prRef: string | null;
  dimension: string;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  score: string | null;
  summary: Record<string, unknown>;
  createdAt: Date;
}

export class TestRunStore {
  constructor(private readonly db: Db) {}

  async create(input: CreateTestRunInput): Promise<TestRunRow> {
    const [row] = await this.db
      .insert(testRuns)
      .values({
        companyId: input.companyId,
        missionId: input.missionId ?? null,
        prRef: input.prRef ?? null,
        dimension: input.dimension,
        status: "pending",
        summary: {},
        createdAt: new Date(),
      })
      .returning();
    return row as TestRunRow;
  }

  async markRunning(id: string): Promise<void> {
    await this.db
      .update(testRuns)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(testRuns.id, id));
  }

  async markPassed(
    id: string,
    score: number,
    summary: Record<string, unknown> = {},
  ): Promise<void> {
    await this.db
      .update(testRuns)
      .set({
        status: "passed",
        finishedAt: new Date(),
        score: String(score),
        summary,
      })
      .where(eq(testRuns.id, id));
  }

  async markFailed(
    id: string,
    score: number,
    summary: Record<string, unknown> = {},
  ): Promise<void> {
    await this.db
      .update(testRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        score: String(score),
        summary,
      })
      .where(eq(testRuns.id, id));
  }

  async listForPR(prRef: string): Promise<TestRunRow[]> {
    const rows = await this.db
      .select()
      .from(testRuns)
      .where(eq(testRuns.prRef, prRef));
    return rows as TestRunRow[];
  }
}
