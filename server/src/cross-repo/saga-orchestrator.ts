// SagaOrchestrator — pure state-machine + DB writes for cross-repo saga coordination.
// Phase 12 §Services.1.

import { eq, and, asc } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { sagas } from "@paperclipai/db/schema/sagas";
import { sagaSteps } from "@paperclipai/db/schema/saga_steps";

export interface SagaStepDef {
  name: string;
  forwardAction?: Record<string, unknown>;
  compensateAction?: Record<string, unknown>;
}

export type StepRunner = (
  step: { sagaId: string; sequence: number; name: string; forwardAction: Record<string, unknown> | null },
) => Promise<void>;

export type CompensateRunner = (
  step: { sagaId: string; sequence: number; name: string; compensateAction: Record<string, unknown> | null },
) => Promise<void>;

export interface SagaStartResult {
  sagaId: string;
  stepIds: string[];
}

export class SagaOrchestrator {
  constructor(
    private readonly db: Db,
    private readonly runner: StepRunner,
    private readonly compensator: CompensateRunner,
  ) {}

  /**
   * Opens a new saga and creates its saga_steps rows in sequence order.
   * Returns the saga id and ordered step ids.
   */
  async start(
    companyId: string,
    name: string,
    steps: SagaStepDef[],
    payload: Record<string, unknown> = {},
  ): Promise<SagaStartResult> {
    const [saga] = await this.db
      .insert(sagas)
      .values({
        companyId,
        name,
        status: "running",
        startedAt: new Date(),
        payload,
        createdAt: new Date(),
      })
      .returning({ id: sagas.id });

    const sagaId = saga.id;

    const stepRows = steps.map((s, i) => ({
      sagaId,
      sequence: i + 1,
      name: s.name,
      status: "pending" as const,
      forwardAction: s.forwardAction ?? null,
      compensateAction: s.compensateAction ?? null,
    }));

    const insertedSteps = await this.db
      .insert(sagaSteps)
      .values(stepRows)
      .returning({ id: sagaSteps.id });

    return { sagaId, stepIds: insertedSteps.map((r) => r.id) };
  }

  /**
   * Advances the next pending step.
   * - Marks it running, calls runner, marks done on success.
   * - On failure, marks step failed, flips saga to compensating, and runs
   *   compensate_actions in REVERSE sequence order.
   * - After compensation, marks saga aborted.
   * - When all steps are done, marks saga done.
   */
  async tick(sagaId: string): Promise<void> {
    const [saga] = await this.db
      .select()
      .from(sagas)
      .where(eq(sagas.id, sagaId));

    if (!saga) throw new Error(`Saga ${sagaId} not found`);
    if (saga.status === "done" || saga.status === "aborted") return;

    // Find next pending step
    const allSteps = await this.db
      .select()
      .from(sagaSteps)
      .where(eq(sagaSteps.sagaId, sagaId))
      .orderBy(asc(sagaSteps.sequence));

    const nextPending = allSteps.find((s) => s.status === "pending");

    if (!nextPending) {
      // All steps done — mark saga done
      const allDone = allSteps.every((s) => s.status === "done");
      if (allDone) {
        await this.db
          .update(sagas)
          .set({ status: "done", finishedAt: new Date(), outcome: "success" })
          .where(eq(sagas.id, sagaId));
      }
      return;
    }

    // Mark step as running
    await this.db
      .update(sagaSteps)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(sagaSteps.id, nextPending.id));

    try {
      await this.runner({
        sagaId,
        sequence: nextPending.sequence,
        name: nextPending.name,
        forwardAction: (nextPending.forwardAction as Record<string, unknown> | null) ?? null,
      });

      // Mark step done
      await this.db
        .update(sagaSteps)
        .set({ status: "done", finishedAt: new Date() })
        .where(eq(sagaSteps.id, nextPending.id));

      // Check if this was the last step
      const remaining = await this.db
        .select({ status: sagaSteps.status })
        .from(sagaSteps)
        .where(and(eq(sagaSteps.sagaId, sagaId)));

      const allDone = remaining.every((s) => s.status === "done");
      if (allDone) {
        await this.db
          .update(sagas)
          .set({ status: "done", finishedAt: new Date(), outcome: "success" })
          .where(eq(sagas.id, sagaId));
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Mark this step failed
      await this.db
        .update(sagaSteps)
        .set({ status: "failed", finishedAt: new Date(), error: errorMsg })
        .where(eq(sagaSteps.id, nextPending.id));

      // Flip saga to compensating
      await this.db
        .update(sagas)
        .set({ status: "compensating" })
        .where(eq(sagas.id, sagaId));

      // Run compensate_actions in REVERSE order for steps that completed (done)
      const doneSteps = allSteps
        .filter((s) => s.status === "done" || s.id === nextPending.id)
        // include only actually-done steps for compensation
        .filter((s) => s.status === "done")
        .sort((a, b) => b.sequence - a.sequence); // REVERSE

      for (const step of doneSteps) {
        try {
          await this.compensator({
            sagaId,
            sequence: step.sequence,
            name: step.name,
            compensateAction: (step.compensateAction as Record<string, unknown> | null) ?? null,
          });
          await this.db
            .update(sagaSteps)
            .set({ status: "compensated" })
            .where(eq(sagaSteps.id, step.id));
        } catch (compErr) {
          // Best-effort compensation; record error and continue
          const compErrMsg = compErr instanceof Error ? compErr.message : String(compErr);
          await this.db
            .update(sagaSteps)
            .set({ error: `compensation failed: ${compErrMsg}` })
            .where(eq(sagaSteps.id, step.id));
        }
      }

      // Mark saga aborted
      await this.db
        .update(sagas)
        .set({ status: "aborted", finishedAt: new Date(), outcome: "compensation_complete" })
        .where(eq(sagas.id, sagaId));
    }
  }
}
