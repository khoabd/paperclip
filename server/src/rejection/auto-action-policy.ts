// Pure AutoActionPolicy: maps cluster characteristics → auto-action string.
// Per Phase-10 spec §10.2 and Rejection-Learning §4.3.
// No DB calls — fully deterministic.

export type AutoAction =
  | "notify"
  | "escalate_to_intake"
  | "adjust_prompt"
  | "adjust_principle"
  | "tighten_qa"
  | "tighten_security"
  | "adjust_velocity";

// Categories that warrant strategic escalation when cluster is large enough
const STRATEGIC_CATEGORIES = new Set<string>([
  "spec_violation",
  "design_conflict",
  "security",
  "wrong_scope",
  "cost",
  "timeline",
  "other",
]);

export interface ClusterInput {
  category: string | null | undefined;
  size: number;
  windowDays: number;
}

export class AutoActionPolicy {
  /**
   * Given a cluster's metadata, return the recommended auto-action.
   * Spec: size ≥ 5 AND category ∈ strategic-relevant → escalate_to_intake.
   * Smaller clusters → notify (with category-specific defaults).
   */
  decide(input: ClusterInput): AutoAction {
    const { category, size } = input;
    const cat = category ?? "other";

    if (size >= 5 && STRATEGIC_CATEGORIES.has(cat)) {
      return "escalate_to_intake";
    }

    // Category-specific suggestions for smaller clusters
    switch (cat) {
      case "security":
        return "tighten_security";
      case "spec_violation":
      case "test_gap":
      case "accessibility":
        return "tighten_qa";
      case "design_conflict":
        return "adjust_principle";
      case "wrong_scope":
        return "adjust_prompt";
      case "cost":
      case "timeline":
        return "adjust_velocity";
      default:
        return "notify";
    }
  }
}
