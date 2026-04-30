// Class-based L1 timeline brackets per Human-Intake §6.2.
// L2/L3 are deferred to Phase 11 (KB) and Phase 6+ (heartbeat) respectively.

import type { IntakeType } from "./intake-classifier.js";
import type { Priority } from "./intake-priority.js";

export interface L1Bracket {
  p50Days: number;
  p90Days: number;
  rationale: string;
}

const BRACKETS: Record<string, { p50: number; p90: number }> = {
  "problem|P0": { p50: 1, p90: 3 },
  "problem|P1": { p50: 3, p90: 7 },
  "problem|P2": { p50: 5, p90: 14 },
  "problem|P3": { p50: 7, p90: 21 },
  "feature_request|P0": { p50: 3, p90: 10 },
  "feature_request|P1": { p50: 5, p90: 15 },
  "feature_request|P2": { p50: 10, p90: 30 },
  "feature_request|P3": { p50: 14, p90: 45 },
  "bug_report|P0": { p50: 0.5, p90: 2 },
  "bug_report|P1": { p50: 1, p90: 5 },
  "bug_report|P2": { p50: 3, p90: 10 },
  "bug_report|P3": { p50: 5, p90: 14 },
  "strategic_input|*": { p50: 1, p90: 3 },
  "question|*": { p50: 0.01, p90: 0.1 },
};

export function estimateL1(type: IntakeType, priority: Priority): L1Bracket | null {
  // Passive feedback types have no ETA per design.
  if (type === "feedback_general" || type === "feedback_release" || type === "feedback_feature") {
    return null;
  }
  const exact = BRACKETS[`${type}|${priority}`];
  const wildcard = BRACKETS[`${type}|*`];
  const hit = exact ?? wildcard;
  if (!hit) return null;
  return {
    p50Days: hit.p50,
    p90Days: hit.p90,
    rationale: `L1 bracket for ${type}/${priority}`,
  };
}
