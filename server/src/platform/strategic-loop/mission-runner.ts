// Drives one mission tick: load state, decide next move, persist transition + step changes.
// Per Phase-4-Strategic-Loop-Foundation §4.3.

import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  missions,
  missionSteps,
  missionStateTransitions,
  missionReflections,
} from "@paperclipai/db";
import {
  canTransition,
  isTerminal,
  type Actor,
  type MissionStatus,
} from "./mission-state-machine.js";
import { BrainStore } from "./brain-store.js";

export interface TickReport {
  missionId: string;
  fromStatus: MissionStatus;
  toStatus: MissionStatus;
  transitioned: boolean;
  reason: string;
  stepsQueued: number;
  stepsRunning: number;
  stepsPending: number;
  stepsFailed: number;
  stepsDone: number;
  notes?: string[];
}

export interface PlanningSeed {
  steps: Array<{ kind: string; title: string; inputs?: Record<string, unknown> }>;
}

export interface ReflectorSignal {
  wantsDone?: boolean;
  wantsReplan?: boolean;
  finishedOutcome?: string;
  notes?: string[];
}

export interface MissionRunnerDeps {
  db: Db;
  brain: BrainStore;
  /** Returns next ordered list of steps to enqueue when intake/planning resolves. */
  planner?: (missionId: string) => Promise<PlanningSeed>;
  /** Tells us what the reflecting phase decided. */
  reflector?: (missionId: string) => Promise<ReflectorSignal>;
}

const STEP_QUEUED = "queued";
const STEP_RUNNING = "running";
const STEP_PENDING = "pending";
const STEP_DONE = "done";
const STEP_FAILED = "failed";

export class MissionRunner {
  constructor(private readonly deps: MissionRunnerDeps) {}

  async tick(missionId: string, actor: Actor = "runner"): Promise<TickReport> {
    const { db } = this.deps;
    const mission = (
      await db.select().from(missions).where(eq(missions.id, missionId)).limit(1)
    )[0];
    if (!mission) {
      return emptyReport(missionId, "intake", "mission not found");
    }
    const fromStatus = mission.status as MissionStatus;
    if (isTerminal(fromStatus)) {
      const counts = await this.stepCounts(missionId);
      return {
        missionId,
        fromStatus,
        toStatus: fromStatus,
        transitioned: false,
        reason: "terminal",
        ...counts,
      };
    }

    const counts = await this.stepCounts(missionId);
    const reflector =
      fromStatus === "reflecting" && this.deps.reflector ? await this.deps.reflector(missionId) : null;

    // If we're in planning with no queued/pending steps, run the planner up front
    // so canTransition can see the freshly seeded queue.
    let seedSteps: PlanningSeed["steps"] = [];
    if (
      fromStatus === "planning" &&
      this.deps.planner &&
      counts.stepsQueued + counts.stepsPending === 0
    ) {
      const seed = await this.deps.planner(missionId);
      seedSteps = seed.steps;
    }
    const projectedQueued = counts.stepsQueued + seedSteps.length;

    const candidates = nextCandidates(fromStatus, actor, {
      failedSteps: counts.stepsFailed,
    });
    let chosen: { to: MissionStatus; reason: string } | null = null;
    for (const to of candidates) {
      const verdict = canTransition({
        from: fromStatus,
        to,
        actor,
        ctx: {
          queuedSteps: projectedQueued,
          runningSteps: counts.stepsRunning,
          pendingSteps: counts.stepsPending,
          failedSteps: counts.stepsFailed,
          doneSteps: counts.stepsDone,
          reflectorWantsDone: !!reflector?.wantsDone,
          reflectorWantsReplan: !!reflector?.wantsReplan,
          gateTimedOut: false,
        },
      });
      if (verdict.ok) {
        chosen = { to, reason: `${fromStatus}->${to}` };
        break;
      }
    }
    if (!chosen) {
      return {
        missionId,
        fromStatus,
        toStatus: fromStatus,
        transitioned: false,
        reason: "no legal transition yet",
        ...counts,
      };
    }

    await db.transaction(async (tx) => {
      if (seedSteps.length > 0) {
        // Determine next seq.
        const existing = await tx
          .select({ seq: missionSteps.seq })
          .from(missionSteps)
          .where(eq(missionSteps.missionId, missionId));
        let nextSeq = existing.reduce((m, r) => Math.max(m, r.seq), 0) + 1;
        for (const s of seedSteps) {
          await tx.insert(missionSteps).values({
            missionId,
            seq: nextSeq++,
            kind: s.kind,
            title: s.title,
            inputs: s.inputs ?? {},
            status: STEP_QUEUED,
          });
        }
      }

      await tx
        .update(missions)
        .set({
          status: chosen!.to,
          updatedAt: new Date(),
          finishedAt: chosen!.to === "done" ? new Date() : null,
          finishedOutcome: chosen!.to === "done" ? reflector?.finishedOutcome ?? "ok" : null,
        })
        .where(eq(missions.id, missionId));

      await tx.insert(missionStateTransitions).values({
        missionId,
        fromStatus,
        toStatus: chosen!.to,
        reason: chosen!.reason,
      });

      if (fromStatus === "reflecting" && reflector?.notes && reflector.notes.length > 0) {
        await tx.insert(missionReflections).values(
          reflector.notes.map((n) => ({
            missionId,
            kind: "note",
            body: n,
          })),
        );
      }
    });

    if (chosen.to === "done") {
      await this.deps.brain.appendInsight({
        workspaceId: mission.companyId,
        kind: "mission.done",
        body: `Mission ${mission.title} finished: ${reflector?.finishedOutcome ?? "ok"}`,
      });
    }

    const after = await this.stepCounts(missionId);
    return {
      missionId,
      fromStatus,
      toStatus: chosen.to,
      transitioned: true,
      reason: chosen.reason,
      ...after,
      notes: reflector?.notes,
    };
  }

  private async stepCounts(missionId: string): Promise<{
    stepsQueued: number;
    stepsRunning: number;
    stepsPending: number;
    stepsFailed: number;
    stepsDone: number;
  }> {
    const rows = await this.deps.db
      .select({ status: missionSteps.status })
      .from(missionSteps)
      .where(eq(missionSteps.missionId, missionId));
    let q = 0,
      r = 0,
      p = 0,
      f = 0,
      d = 0;
    for (const row of rows) {
      switch (row.status) {
        case STEP_QUEUED:
          q++;
          break;
        case STEP_RUNNING:
          r++;
          break;
        case STEP_PENDING:
          p++;
          break;
        case STEP_FAILED:
          f++;
          break;
        case STEP_DONE:
          d++;
          break;
      }
    }
    return {
      stepsQueued: q,
      stepsRunning: r,
      stepsPending: p,
      stepsFailed: f,
      stepsDone: d,
    };
  }

  /** Helper for executors: mark a step as done so the next tick can advance. */
  async markStepsDone(missionId: string, statuses: string[] = [STEP_QUEUED, STEP_RUNNING, STEP_PENDING]): Promise<void> {
    await this.deps.db
      .update(missionSteps)
      .set({ status: STEP_DONE, finishedAt: new Date() })
      .where(and(eq(missionSteps.missionId, missionId), inArray(missionSteps.status, statuses)));
  }
}

function nextCandidates(
  from: MissionStatus,
  actor: Actor,
  hint: { failedSteps: number } = { failedSteps: 0 },
): MissionStatus[] {
  if (actor === "user") {
    if (from === "blocked") return ["planning"];
    return [];
  }
  switch (from) {
    case "intake":
      return ["planning"];
    case "planning":
      return ["executing"];
    case "executing":
      return hint.failedSteps > 0 ? ["blocked", "reflecting"] : ["reflecting", "blocked"];
    case "reflecting":
      return ["done", "planning", "blocked"];
    default:
      return [];
  }
}

function emptyReport(missionId: string, fromStatus: MissionStatus, reason: string): TickReport {
  return {
    missionId,
    fromStatus,
    toStatus: fromStatus,
    transitioned: false,
    reason,
    stepsQueued: 0,
    stepsRunning: 0,
    stepsPending: 0,
    stepsFailed: 0,
    stepsDone: 0,
  };
}
