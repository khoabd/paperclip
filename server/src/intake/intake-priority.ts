// Pure priority bucketing per Human-Intake §4.3.

import type { IntakeType } from "./intake-classifier.js";

export type Priority = "P0" | "P1" | "P2" | "P3";

export interface PriorityInput {
  type: IntakeType;
  severity?: "crash" | "data_loss" | "broken_flow" | "visual" | null;
  affectedUsersEstimated?: number | null;
  revenueImpactScore?: number | null;
  customerDemandSignals?: number | null;
  submitterMood?: number | null;
}

const SEVERITY_SCORES = {
  crash: 30,
  data_loss: 50,
  broken_flow: 20,
  visual: 5,
} as const;

export function priorityOf(input: PriorityInput): Priority {
  let score = 0;

  if (input.type === "bug_report" && input.severity) {
    score += SEVERITY_SCORES[input.severity];
    score += Math.floor((input.affectedUsersEstimated ?? 0) / 100);
  } else if (input.type === "problem") {
    score += input.revenueImpactScore ?? 0;
  } else if (input.type === "feature_request") {
    score += input.customerDemandSignals ?? 0;
  } else if (input.type === "strategic_input") {
    score += 30;
  } else if (input.type === "feedback_release" || input.type === "feedback_feature") {
    score += 10;
  } else if (input.type === "question") {
    score += 5;
  }

  // Submitter mood ≤ 2 ⇒ surface harder; ≥ 4 ⇒ dampen.
  if (input.submitterMood != null) {
    if (input.submitterMood <= 2) score += 10;
    else if (input.submitterMood >= 4) score -= 5;
  }

  if (score >= 80) return "P0";
  if (score >= 50) return "P1";
  if (score >= 20) return "P2";
  return "P3";
}
