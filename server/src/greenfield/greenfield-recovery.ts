// GreenfieldRecovery — applies recovery actions to failed stages.
// Per Phase-8-Greenfield-Bootstrap §8.2.

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { greenfieldStages, greenfieldIntakes, intakeRecoveryActions } from "@paperclipai/db";
import {
  canApplyRecovery,
  recoveryResultStageStatus,
  type RecoveryKind,
} from "./greenfield-state-machine.js";

export interface ApplyRecoveryInput {
  stageId: string;
  kind: RecoveryKind;
  /** Optional detail to persist in the action log. */
  actionDetail?: Record<string, unknown>;
}

export interface ApplyRecoveryResult {
  stageId: string;
  kind: RecoveryKind;
  newStageStatus: string;
  /** Populated when kind==='abort'. */
  intakeAborted?: boolean;
  attemptNumber: number;
}

export class GreenfieldRecovery {
  constructor(private readonly db: Db) {}

  async apply(input: ApplyRecoveryInput): Promise<ApplyRecoveryResult> {
    const stage = (
      await this.db
        .select()
        .from(greenfieldStages)
        .where(eq(greenfieldStages.id, input.stageId))
        .limit(1)
    )[0];
    if (!stage) throw new Error(`greenfield stage not found: ${input.stageId}`);

    // Validate transition
    const verdict = canApplyRecovery({ stageStatus: stage.status as any, kind: input.kind });
    if (!verdict.ok) throw new Error(verdict.reason);

    // Count prior recovery attempts for this stage
    const priorActions = await this.db
      .select()
      .from(intakeRecoveryActions)
      .where(eq(intakeRecoveryActions.stageId, input.stageId));
    const attemptNumber = priorActions.length + 1;

    // Persist recovery action
    await this.db.insert(intakeRecoveryActions).values({
      stageId: input.stageId,
      kind: input.kind,
      attemptNumber,
      action: input.actionDetail ?? {},
      result: `applied:${input.kind}`,
    });

    const newStageStatus = recoveryResultStageStatus(input.kind);

    if (input.kind === "abort") {
      // Mark stage failed (already failed) and cascade to intake
      const intake = (
        await this.db
          .select()
          .from(greenfieldIntakes)
          .where(eq(greenfieldIntakes.id, stage.intakeId))
          .limit(1)
      )[0];
      if (intake) {
        const now = new Date();
        const startedAt = intake.startedAt ?? now;
        const wallClockMs = now.getTime() - startedAt.getTime();
        await this.db
          .update(greenfieldIntakes)
          .set({ status: "aborted", finishedAt: now, wallClockMs })
          .where(eq(greenfieldIntakes.id, intake.id));
      }
      return {
        stageId: input.stageId,
        kind: input.kind,
        newStageStatus: "failed",
        intakeAborted: true,
        attemptNumber,
      };
    }

    if (input.kind === "skip") {
      // Mark stage done with empty outputs and a TODO note
      await this.db
        .update(greenfieldStages)
        .set({
          status: "done",
          outputs: { skipped: true, note: "Stage skipped via recovery action" },
          finishedAt: new Date(),
          error: null,
        })
        .where(eq(greenfieldStages.id, input.stageId));
    } else {
      // retry | alt_path: return stage to pending for re-run
      await this.db
        .update(greenfieldStages)
        .set({ status: "pending", error: null, startedAt: null, finishedAt: null })
        .where(eq(greenfieldStages.id, input.stageId));
    }

    return {
      stageId: input.stageId,
      kind: input.kind,
      newStageStatus,
      intakeAborted: false,
      attemptNumber,
    };
  }
}
