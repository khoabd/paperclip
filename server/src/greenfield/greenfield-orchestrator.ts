// GreenfieldOrchestrator — drives tick(intakeId).
// Per Phase-8-Greenfield-Bootstrap §8.2.
//
// All per-stage runners are dependency-injected so tests can stub them.

import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  greenfieldIntakes,
  greenfieldStages,
  intakeRecoveryActions,
  missions,
  approvals,
} from "@paperclipai/db";
import { BrainStore } from "../platform/strategic-loop/brain-store.js";
import { CostAttributor } from "../platform/cost-attributor.js";
import {
  canTransitionStage,
  canTransitionIntake,
  isTerminalIntake,
  type StageName,
  type StageStatus,
  type IntakeStatus,
} from "./greenfield-state-machine.js";

// ── Runner context passed to each stage runner ─────────────────────────────

export interface StageRunnerContext {
  intakeId: string;
  companyId: string;
  ideaTitle: string;
  ideaText: string;
  /** Accumulated outputs from all prior stages. */
  priorOutputs: Record<string, unknown>;
  db: Db;
  brainStore: BrainStore;
}

// ── Per-stage runner signatures ────────────────────────────────────────────

export interface PersonaDoc {
  slug: string;
  body: string;
}

export interface StageRunners {
  ideaRefinement(ctx: StageRunnerContext): Promise<Record<string, unknown>>;
  marketResearch(ctx: StageRunnerContext): Promise<{ notes: string }>;
  personas(ctx: StageRunnerContext): Promise<{ personas: PersonaDoc[] }>;
  stack(ctx: StageRunnerContext): Promise<{ stackJson: string }>;
  brain(ctx: StageRunnerContext): Promise<{ brainBody: string }>;
  repoScaffold(ctx: StageRunnerContext): Promise<{ repoUrl: string; defaultBranch: string }>;
  sprint1(ctx: StageRunnerContext): Promise<{ missionId: string }>;
}

// ── Tick result ────────────────────────────────────────────────────────────

export interface TickResult {
  intakeStatus: IntakeStatus;
  /** Which stage was advanced (if any). */
  stageName?: StageName;
  stageStatus?: StageStatus;
  /** Set when a gate was opened. */
  gateApprovalId?: string;
  /** Set when a new mission was spawned. */
  missionId?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const STAGE_RUNNER_MAP: Record<StageName, keyof StageRunners> = {
  idea_refinement: "ideaRefinement",
  market_research: "marketResearch",
  personas: "personas",
  stack: "stack",
  brain: "brain",
  repo_scaffold: "repoScaffold",
  sprint1: "sprint1",
};

// ── Orchestrator ───────────────────────────────────────────────────────────

export class GreenfieldOrchestrator {
  constructor(
    private readonly db: Db,
    private readonly brainStore: BrainStore,
    private readonly costAttributor: CostAttributor,
    private readonly runners: StageRunners,
  ) {}

  /**
   * Advance the intake by one stage.
   * - If intake is pending, flip to running + set started_at.
   * - Load stages ordered by sequence.
   * - Pick the first non-terminal stage.
   * - If gated, check if the approval is resolved; if not, return gate_pending.
   * - Run the stage runner, persist outputs, flip stage to done.
   * - If sprint1 done → flip intake to done.
   * - Cost telemetry is recorded per stage via CostAttributor.
   */
  async tick(intakeId: string): Promise<TickResult> {
    // Load intake
    const intake = (
      await this.db
        .select()
        .from(greenfieldIntakes)
        .where(eq(greenfieldIntakes.id, intakeId))
        .limit(1)
    )[0];
    if (!intake) throw new Error(`greenfield intake not found: ${intakeId}`);

    if (isTerminalIntake(intake.status as IntakeStatus)) {
      return { intakeStatus: intake.status as IntakeStatus };
    }

    // Flip pending → running
    if (intake.status === "pending") {
      const verdict = canTransitionIntake({ from: "pending", to: "running" });
      if (!verdict.ok) throw new Error(verdict.reason);
      await this.db
        .update(greenfieldIntakes)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(greenfieldIntakes.id, intakeId));
    }

    // Load stages
    const stages = await this.db
      .select()
      .from(greenfieldStages)
      .where(eq(greenfieldStages.intakeId, intakeId))
      .orderBy(asc(greenfieldStages.sequence));

    if (stages.length === 0) {
      throw new Error(`intake ${intakeId} has no stages seeded`);
    }

    // Find next non-terminal stage
    const nextStage = stages.find(
      (s) => s.status !== "done" && s.status !== "failed",
    );

    if (!nextStage) {
      // All stages done — flip intake to done
      await this.finaliseIntake(intakeId, "done");
      return { intakeStatus: "done" };
    }

    // Handle gated stage: check if approval resolved
    if (nextStage.status === "gated") {
      if (nextStage.gateApprovalId) {
        const approval = (
          await this.db
            .select()
            .from(approvals)
            .where(eq(approvals.id, nextStage.gateApprovalId))
            .limit(1)
        )[0];
        if (!approval || approval.status !== "approved") {
          // Still waiting
          await this.db
            .update(greenfieldIntakes)
            .set({ status: "gate_pending" })
            .where(eq(greenfieldIntakes.id, intakeId));
          return {
            intakeStatus: "gate_pending",
            stageName: nextStage.stageName as StageName,
            stageStatus: "gated",
            gateApprovalId: nextStage.gateApprovalId,
          };
        }
        // Approval resolved — flip stage back to pending
        await this.db
          .update(greenfieldStages)
          .set({ status: "pending", gateApprovalId: null })
          .where(eq(greenfieldStages.id, nextStage.id));
        // Flip intake back to running
        await this.db
          .update(greenfieldIntakes)
          .set({ status: "running" })
          .where(eq(greenfieldIntakes.id, intakeId));
        // Re-tick to run the stage now
        return this.tick(intakeId);
      }
    }

    // Flip stage pending → running
    if (nextStage.status === "pending") {
      const sv = canTransitionStage({ from: "pending", to: "running" });
      if (!sv.ok) throw new Error(sv.reason);
      await this.db
        .update(greenfieldStages)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(greenfieldStages.id, nextStage.id));
    }

    // Build prior outputs
    const priorOutputs: Record<string, unknown> = {};
    for (const s of stages) {
      if (s.id === nextStage.id) break;
      if (s.outputs && typeof s.outputs === "object") {
        Object.assign(priorOutputs, s.outputs);
      }
    }

    const ctx: StageRunnerContext = {
      intakeId,
      companyId: intake.companyId,
      ideaTitle: intake.ideaTitle,
      ideaText: intake.ideaText,
      priorOutputs,
      db: this.db,
      brainStore: this.brainStore,
    };

    const stageName = nextStage.stageName as StageName;
    const runnerKey = STAGE_RUNNER_MAP[stageName];

    try {
      const startMs = Date.now();
      const outputs = await (this.runners[runnerKey] as (ctx: StageRunnerContext) => Promise<Record<string, unknown>>)(ctx);
      const elapsedMs = Date.now() - startMs;

      // Persist outputs and flip stage done
      await this.db
        .update(greenfieldStages)
        .set({ status: "done", outputs, finishedAt: new Date() })
        .where(eq(greenfieldStages.id, nextStage.id));

      // Record cost telemetry (stub cost based on stage)
      const stageCostUsd = STAGE_COST_USD[stageName] ?? 0.1;
      await this.costAttributor.record({
        companyId: intake.companyId,
        modelCallId: `greenfield:${intakeId}:${stageName}:1`,
        model: "greenfield-stub",
        tokensIn: 1000,
        tokensOut: 500,
        costUsd: stageCostUsd,
        metadata: { intakeId, stageName, elapsedMs },
      });

      // Stage-specific side effects
      await this.runSideEffects(stageName, intake.companyId, intakeId, outputs as Record<string, unknown>);

      // Check if this was the last stage
      const allDone = stages
        .filter((s) => s.id !== nextStage.id)
        .every((s) => s.status === "done");
      const isLastStage = stageName === "sprint1";

      let finalIntakeStatus: IntakeStatus = "running";
      if (isLastStage) {
        await this.finaliseIntake(intakeId, "done");
        finalIntakeStatus = "done";
      }

      const result: TickResult = {
        intakeStatus: finalIntakeStatus,
        stageName,
        stageStatus: "done",
      };
      if (isLastStage && typeof (outputs as Record<string, unknown>).missionId === "string") {
        result.missionId = (outputs as Record<string, unknown>).missionId as string;
      }
      return result;
    } catch (err) {
      // Mark stage failed
      await this.db
        .update(greenfieldStages)
        .set({
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          finishedAt: new Date(),
        })
        .where(eq(greenfieldStages.id, nextStage.id));
      throw err;
    }
  }

  // ── Side effects per stage ─────────────────────────────────────────────

  private async runSideEffects(
    stageName: StageName,
    companyId: string,
    intakeId: string,
    outputs: Record<string, unknown>,
  ): Promise<void> {
    switch (stageName) {
      case "market_research": {
        const notes = (outputs as { notes?: string }).notes ?? "";
        if (notes) {
          await this.brainStore.setMarketResearch(companyId, intakeId, notes);
        }
        break;
      }
      case "personas": {
        const personas = (outputs as { personas?: Array<{ slug: string; body: string }> }).personas ?? [];
        for (const p of personas) {
          await this.brainStore.setPersonaDoc(companyId, p.slug, p.body);
        }
        break;
      }
      case "stack": {
        const stackJson = (outputs as { stackJson?: string }).stackJson ?? "{}";
        await this.brainStore.setStackDoc(companyId, intakeId, stackJson);
        break;
      }
      case "brain": {
        const brainBody = (outputs as { brainBody?: string }).brainBody ?? "";
        if (brainBody) {
          await this.brainStore.setGreenfieldBrain(companyId, intakeId, brainBody);
        }
        break;
      }
      case "sprint1": {
        // Mission is already spawned by the sprint1 runner
        break;
      }
    }
  }

  // ── Finalise intake ────────────────────────────────────────────────────

  private async finaliseIntake(intakeId: string, status: "done" | "aborted"): Promise<void> {
    const now = new Date();
    const intake = (
      await this.db
        .select()
        .from(greenfieldIntakes)
        .where(eq(greenfieldIntakes.id, intakeId))
        .limit(1)
    )[0];
    if (!intake) return;

    const startedAt = intake.startedAt ?? now;
    const wallClockMs = now.getTime() - startedAt.getTime();

    // Sum costs
    const costRows = await this.db
      .select({ costUsd: greenfieldStages.outputs })
      .from(greenfieldStages)
      .where(eq(greenfieldStages.intakeId, intakeId));

    // Use CostAttributor sum for this workspace
    const totalCost = await this.costAttributor.sumCostForCompanyBetween(
      intake.companyId,
      startedAt,
      now,
    );

    await this.db
      .update(greenfieldIntakes)
      .set({
        status,
        finishedAt: now,
        wallClockMs,
        totalCostUsd: totalCost.toFixed(4),
      })
      .where(eq(greenfieldIntakes.id, intakeId));
  }
}

// Stage cost estimates (used for telemetry stubs in tests / non-production)
const STAGE_COST_USD: Record<StageName, number> = {
  idea_refinement: 0.20,
  market_research: 1.50,
  personas: 0.80,
  stack: 0.40,
  brain: 0.30,
  repo_scaffold: 0.10,
  sprint1: 0.50,
};
