// Persistence helpers for intake_items / workflow_states / solutions / timelines.
// Per Phase-5-Human-Intake-Hub §5.2.

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  intakeItems,
  intakeWorkflowStates,
  intakeSolutions,
  intakeTimelineEstimates,
  intakeOutcomeTracker,
} from "@paperclipai/db";
import type { IntakeType } from "./intake-classifier.js";
import type { Priority } from "./intake-priority.js";

export interface CreateIntakeInput {
  companyId: string;
  type: IntakeType;
  rawText: string;
  title?: string | null;
  submitterUserId?: string | null;
  submitterMood?: number | null;
  attachments?: unknown[];
  linkedReleaseTag?: string | null;
  linkedFeatureKey?: string | null;
  classifiedTypeConfidence?: number | null;
  source?: string;
  sourceRef?: string | null;
  spec?: string | null;
  priority?: Priority | null;
}

export interface AppendStateInput {
  intakeId: string;
  state: string;
  actorAgentId?: string | null;
  actorUserId?: string | null;
  notes?: string | null;
}

export interface AppendTimelineInput {
  intakeId: string;
  level: "L1" | "L2" | "L3";
  p50Days: number | null;
  p90Days: number | null;
  source: string;
  rationale?: string | null;
}

export interface AddSolutionInput {
  intakeId: string;
  candidateIdx: number;
  title: string;
  scope?: Record<string, unknown>;
  effortDays?: number | null;
  riskScore?: number | null;
  etaP50Days?: number | null;
  etaP90Days?: number | null;
  costUsd?: number | null;
}

export class IntakeStore {
  constructor(private readonly db: Db) {}

  async create(input: CreateIntakeInput): Promise<string> {
    const inserted = (
      await this.db
        .insert(intakeItems)
        .values({
          companyId: input.companyId,
          type: input.type,
          rawText: input.rawText,
          title: input.title ?? null,
          submitterUserId: input.submitterUserId ?? null,
          submitterMood: input.submitterMood ?? null,
          attachments: (input.attachments ?? []) as unknown as Record<string, unknown>,
          linkedReleaseTag: input.linkedReleaseTag ?? null,
          linkedFeatureKey: input.linkedFeatureKey ?? null,
          classifiedTypeConf:
            input.classifiedTypeConfidence != null ? input.classifiedTypeConfidence.toString() : null,
          source: input.source ?? "human_console",
          sourceRef: input.sourceRef ?? null,
          spec: input.spec ?? null,
          priority: input.priority ?? null,
        })
        .returning({ id: intakeItems.id })
    )[0]!;
    await this.db.insert(intakeWorkflowStates).values({
      intakeId: inserted.id,
      state: "triaged",
    });
    return inserted.id;
  }

  async getById(intakeId: string) {
    return (
      await this.db.select().from(intakeItems).where(eq(intakeItems.id, intakeId)).limit(1)
    )[0];
  }

  async listByCompany(companyId: string, opts: { state?: string; limit?: number } = {}) {
    const limit = opts.limit ?? 50;
    const where = opts.state
      ? and(
          eq(intakeItems.companyId, companyId),
          eq(intakeItems.state, opts.state),
          isNull(intakeItems.closedAt),
        )
      : and(eq(intakeItems.companyId, companyId), isNull(intakeItems.closedAt));
    return this.db
      .select()
      .from(intakeItems)
      .where(where)
      .orderBy(desc(intakeItems.createdAt))
      .limit(limit);
  }

  async appendWorkflowState(input: AppendStateInput): Promise<void> {
    // Close out the previous open state row.
    await this.db
      .update(intakeWorkflowStates)
      .set({
        leftAt: new Date(),
        durationMin: sql`EXTRACT(EPOCH FROM (now() - ${intakeWorkflowStates.enteredAt})) / 60`,
      })
      .where(
        and(
          eq(intakeWorkflowStates.intakeId, input.intakeId),
          isNull(intakeWorkflowStates.leftAt),
        ),
      );
    await this.db.insert(intakeWorkflowStates).values({
      intakeId: input.intakeId,
      state: input.state,
      actorAgentId: input.actorAgentId ?? null,
      actorUserId: input.actorUserId ?? null,
      notes: input.notes ?? null,
    });
    await this.db
      .update(intakeItems)
      .set({ state: input.state, updatedAt: new Date() })
      .where(eq(intakeItems.id, input.intakeId));
  }

  async listWorkflowStates(intakeId: string) {
    return this.db
      .select()
      .from(intakeWorkflowStates)
      .where(eq(intakeWorkflowStates.intakeId, intakeId))
      .orderBy(asc(intakeWorkflowStates.enteredAt));
  }

  async addTimelineEstimate(input: AppendTimelineInput): Promise<void> {
    await this.db.insert(intakeTimelineEstimates).values({
      intakeId: input.intakeId,
      level: input.level,
      p50Days: input.p50Days != null ? input.p50Days.toString() : null,
      p90Days: input.p90Days != null ? input.p90Days.toString() : null,
      source: input.source,
      rationale: input.rationale ?? null,
    });
  }

  async listTimelineEstimates(intakeId: string) {
    return this.db
      .select()
      .from(intakeTimelineEstimates)
      .where(eq(intakeTimelineEstimates.intakeId, intakeId))
      .orderBy(desc(intakeTimelineEstimates.computedAt));
  }

  async addSolution(input: AddSolutionInput): Promise<string> {
    const inserted = (
      await this.db
        .insert(intakeSolutions)
        .values({
          intakeId: input.intakeId,
          candidateIdx: input.candidateIdx,
          title: input.title,
          scope: input.scope ?? {},
          effortDays: input.effortDays != null ? input.effortDays.toString() : null,
          riskScore: input.riskScore != null ? input.riskScore.toString() : null,
          etaP50Days: input.etaP50Days != null ? input.etaP50Days.toString() : null,
          etaP90Days: input.etaP90Days != null ? input.etaP90Days.toString() : null,
          costUsd: input.costUsd != null ? input.costUsd.toString() : null,
        })
        .returning({ id: intakeSolutions.id })
    )[0]!;
    return inserted.id;
  }

  async listSolutions(intakeId: string) {
    return this.db
      .select()
      .from(intakeSolutions)
      .where(eq(intakeSolutions.intakeId, intakeId))
      .orderBy(asc(intakeSolutions.candidateIdx));
  }

  async selectSolution(
    intakeId: string,
    candidateIdx: number,
    reason?: string | null,
  ): Promise<void> {
    await this.db
      .update(intakeSolutions)
      .set({ selected: false })
      .where(eq(intakeSolutions.intakeId, intakeId));
    await this.db
      .update(intakeSolutions)
      .set({ selected: true, selectionReason: reason ?? null })
      .where(
        and(
          eq(intakeSolutions.intakeId, intakeId),
          eq(intakeSolutions.candidateIdx, candidateIdx),
        ),
      );
  }

  async setMissionId(intakeId: string, missionId: string): Promise<void> {
    await this.db
      .update(intakeItems)
      .set({ missionId, updatedAt: new Date() })
      .where(eq(intakeItems.id, intakeId));
  }

  async setSpec(intakeId: string, spec: string): Promise<void> {
    await this.db
      .update(intakeItems)
      .set({ spec, updatedAt: new Date() })
      .where(eq(intakeItems.id, intakeId));
  }

  async setPriority(intakeId: string, priority: Priority): Promise<void> {
    await this.db
      .update(intakeItems)
      .set({ priority, updatedAt: new Date() })
      .where(eq(intakeItems.id, intakeId));
  }

  async preallocateOutcomeTracker(
    intakeId: string,
    predictedEtaP50Days: number | null,
    predictedCostUsd: number | null,
  ): Promise<void> {
    await this.db
      .insert(intakeOutcomeTracker)
      .values({
        intakeId,
        predictedEtaP50Days: predictedEtaP50Days != null ? predictedEtaP50Days.toString() : null,
        predictedCostUsd: predictedCostUsd != null ? predictedCostUsd.toString() : null,
      })
      .onConflictDoNothing();
  }

  async close(intakeId: string, acceptanceStatus: "accepted" | "rejected" | "silent"): Promise<void> {
    await this.db
      .update(intakeItems)
      .set({ closedAt: new Date(), state: "closed", updatedAt: new Date() })
      .where(eq(intakeItems.id, intakeId));
    await this.db
      .update(intakeOutcomeTracker)
      .set({ acceptanceStatus, measuredAt: new Date() })
      .where(eq(intakeOutcomeTracker.intakeId, intakeId));
  }
}
