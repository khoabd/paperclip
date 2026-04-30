// Per-type workflow runner. Mile-A focuses on feature_request; other types are stubs.
// Per Phase-5-Human-Intake-Hub §5.2.

import type { IntakeType } from "./intake-classifier.js";
import { IntakeStore } from "./intake-store.js";
import { IntakeMissionBridge } from "./intake-mission-bridge.js";
import { estimateL1 } from "./intake-timeline-l1.js";
import type { Priority } from "./intake-priority.js";

export type IntakeWorkflowState =
  | "triaged"
  | "diagnosed"
  | "spec_drafted"
  | "candidates_ready"
  | "approved_solution"
  | "in_progress"
  | "review_ready"
  | "deployed"
  | "accepted"
  | "closed"
  | "parked";

export interface SpecDraftInput {
  intakeId: string;
  type: IntakeType;
  rawText: string;
  title: string | null;
}

export interface SpecDraft {
  spec: string;
  candidateScopes: Array<{ title: string; scope: Record<string, unknown>; effortDays: number }>;
}

export type SpecDrafter = (input: SpecDraftInput) => Promise<SpecDraft> | SpecDraft;

export interface AdvanceResult {
  intakeId: string;
  fromState: IntakeWorkflowState;
  toState: IntakeWorkflowState;
  notes?: string[];
}

export interface SelectCandidateInput {
  intakeId: string;
  candidateIdx: number;
  reason?: string;
  actorUserId?: string | null;
}

export interface SelectCandidateResult {
  missionId: string;
  intakeId: string;
}

const DEFAULT_DRAFTER: SpecDrafter = ({ rawText, title }) => ({
  spec: `Goal: ${title ?? "(untitled)"}\n\nUser intent:\n${rawText}\n\nAcceptance: solution addresses the intent and ships behind a feature flag.`,
  candidateScopes: [
    {
      title: "Minimal viable shipped behind flag",
      scope: { strategy: "mvp", flagged: true },
      effortDays: 3,
    },
    {
      title: "Polished release with telemetry + docs",
      scope: { strategy: "polished", flagged: true, docs: true },
      effortDays: 7,
    },
  ],
});

export class IntakeWorkflowRunner {
  constructor(
    private readonly store: IntakeStore,
    private readonly bridge: IntakeMissionBridge,
    private readonly specDrafter: SpecDrafter = DEFAULT_DRAFTER,
  ) {}

  async advance(intakeId: string): Promise<AdvanceResult> {
    const intake = await this.store.getById(intakeId);
    if (!intake) throw new Error(`intake not found: ${intakeId}`);
    const from = intake.state as IntakeWorkflowState;

    if (intake.type !== "feature_request") {
      // Other types deferred — park them with a clear note.
      if (from === "triaged") {
        await this.store.appendWorkflowState({
          intakeId,
          state: "parked",
          notes: `Workflow for ${intake.type} deferred to a later phase.`,
        });
        return { intakeId, fromState: from, toState: "parked" };
      }
      return { intakeId, fromState: from, toState: from };
    }

    switch (from) {
      case "triaged":
        return this.draftSpec(intakeId, intake.rawText, intake.title);
      case "spec_drafted":
        return this.proposeCandidates(intakeId, intake.priority as Priority | null);
      default:
        return { intakeId, fromState: from, toState: from };
    }
  }

  private async draftSpec(
    intakeId: string,
    rawText: string,
    title: string | null,
  ): Promise<AdvanceResult> {
    const draft = await this.specDrafter({
      intakeId,
      type: "feature_request",
      rawText,
      title,
    });
    await this.store.setSpec(intakeId, draft.spec);
    await this.store.appendWorkflowState({ intakeId, state: "spec_drafted" });
    return {
      intakeId,
      fromState: "triaged",
      toState: "spec_drafted",
      notes: ["spec drafted; ready for candidate proposal"],
    };
  }

  private async proposeCandidates(
    intakeId: string,
    priority: Priority | null,
  ): Promise<AdvanceResult> {
    const intake = await this.store.getById(intakeId);
    if (!intake) throw new Error(`intake disappeared: ${intakeId}`);
    const draft = await this.specDrafter({
      intakeId,
      type: "feature_request",
      rawText: intake.rawText,
      title: intake.title,
    });
    const l1 = estimateL1("feature_request", priority ?? "P2");
    let idx = 0;
    for (const candidate of draft.candidateScopes) {
      const etaP50 = l1?.p50Days ?? candidate.effortDays;
      const etaP90 = l1?.p90Days ?? candidate.effortDays * 2;
      await this.store.addSolution({
        intakeId,
        candidateIdx: idx,
        title: candidate.title,
        scope: candidate.scope,
        effortDays: candidate.effortDays,
        riskScore: idx === 0 ? 0.2 : 0.4,
        etaP50Days: Math.max(candidate.effortDays * 0.8, etaP50),
        etaP90Days: Math.max(candidate.effortDays * 1.5, etaP90),
        costUsd: candidate.effortDays * 200,
      });
      idx++;
    }
    await this.store.appendWorkflowState({ intakeId, state: "candidates_ready" });
    return {
      intakeId,
      fromState: "spec_drafted",
      toState: "candidates_ready",
      notes: [`${draft.candidateScopes.length} candidates persisted`],
    };
  }

  async selectCandidate(input: SelectCandidateInput): Promise<SelectCandidateResult> {
    const intake = await this.store.getById(input.intakeId);
    if (!intake) throw new Error(`intake not found: ${input.intakeId}`);
    if (intake.state !== "candidates_ready") {
      throw new Error(`cannot select candidate from state ${intake.state}`);
    }
    await this.store.selectSolution(input.intakeId, input.candidateIdx, input.reason);
    await this.store.appendWorkflowState({
      intakeId: input.intakeId,
      state: "approved_solution",
      actorUserId: input.actorUserId ?? null,
      notes: input.reason ?? null,
    });

    const candidates = await this.store.listSolutions(input.intakeId);
    const chosen = candidates.find((c) => c.candidateIdx === input.candidateIdx);
    await this.store.preallocateOutcomeTracker(
      input.intakeId,
      chosen?.etaP50Days != null ? Number(chosen.etaP50Days) : null,
      chosen?.costUsd != null ? Number(chosen.costUsd) : null,
    );

    const spawned = await this.bridge.spawn({
      intakeId: input.intakeId,
      missionTitle: chosen?.title ?? intake.title ?? `Intake ${intake.type}`,
      missionGoal: intake.spec ?? intake.rawText,
    });

    await this.store.appendWorkflowState({
      intakeId: input.intakeId,
      state: "in_progress",
      notes: `mission ${spawned.missionId} spawned`,
    });

    return spawned;
  }
}
