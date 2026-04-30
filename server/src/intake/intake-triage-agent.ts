// First-stage triage: classify → priority → L1 timeline → write to store.
// Per Phase-5-Human-Intake-Hub §5.2 (triage path).

import { classifyIntake, type IntakeType } from "./intake-classifier.js";
import { priorityOf, type Priority, type PriorityInput } from "./intake-priority.js";
import { estimateL1 } from "./intake-timeline-l1.js";
import { IntakeStore, type CreateIntakeInput } from "./intake-store.js";

export interface TriageInput {
  companyId: string;
  rawText: string;
  title?: string | null;
  prefilledType?: IntakeType | null;
  submitterUserId?: string | null;
  submitterMood?: number | null;
  attachments?: unknown[];
  linkedReleaseTag?: string | null;
  linkedFeatureKey?: string | null;
  severity?: PriorityInput["severity"];
  affectedUsersEstimated?: number | null;
  revenueImpactScore?: number | null;
  customerDemandSignals?: number | null;
}

export interface TriageResult {
  intakeId: string;
  type: IntakeType;
  priority: Priority;
  classifierConfidence: number;
  needsHumanType: boolean;
  l1: { p50Days: number; p90Days: number } | null;
}

const HUMAN_TYPE_THRESHOLD = 0.7;

export class IntakeTriageAgent {
  constructor(private readonly store: IntakeStore) {}

  async triage(input: TriageInput): Promise<TriageResult> {
    const classified = classifyIntake({
      text: input.rawText,
      linkedReleaseTag: input.linkedReleaseTag,
      linkedFeatureKey: input.linkedFeatureKey,
      prefilledType: input.prefilledType ?? null,
    });

    const priority = priorityOf({
      type: classified.type,
      severity: input.severity ?? null,
      affectedUsersEstimated: input.affectedUsersEstimated ?? null,
      revenueImpactScore: input.revenueImpactScore ?? null,
      customerDemandSignals: input.customerDemandSignals ?? null,
      submitterMood: input.submitterMood ?? null,
    });

    const createInput: CreateIntakeInput = {
      companyId: input.companyId,
      type: classified.type,
      rawText: input.rawText,
      title: input.title ?? null,
      submitterUserId: input.submitterUserId ?? null,
      submitterMood: input.submitterMood ?? null,
      attachments: input.attachments,
      linkedReleaseTag: input.linkedReleaseTag ?? null,
      linkedFeatureKey: input.linkedFeatureKey ?? null,
      classifiedTypeConfidence: classified.confidence,
      priority,
    };
    const intakeId = await this.store.create(createInput);

    const l1 = estimateL1(classified.type, priority);
    if (l1) {
      await this.store.addTimelineEstimate({
        intakeId,
        level: "L1",
        p50Days: l1.p50Days,
        p90Days: l1.p90Days,
        source: "bracket",
        rationale: l1.rationale,
      });
    }

    return {
      intakeId,
      type: classified.type,
      priority,
      classifierConfidence: classified.confidence,
      needsHumanType:
        classified.source === "heuristic" && classified.confidence < HUMAN_TYPE_THRESHOLD,
      l1: l1 ? { p50Days: l1.p50Days, p90Days: l1.p90Days } : null,
    };
  }
}
