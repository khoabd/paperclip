// Pure composite health-score computation.
// Per Phase-6-Self-Healing-Extension §6.2 + Self-Healing-Design §7.

export type CompositeState = "healthy" | "minor" | "degraded" | "critical";

export interface HealthInputs {
  hasActiveStuckEvent: boolean;
  costRatio: number | null;
  recentKillEventInLast30Min: boolean;
  restartCount: number;
  mcpCascadeOpen: boolean;
  /** Drag-in events emitted in the last 7 days against this workspace. */
  recentDragInCount: number;
  /** Average per-mission score for the workspace rollup. null when computing per-mission. */
  workspaceRollupAverage: number | null;
}

export interface HealthResult {
  score: number;
  compositeState: CompositeState;
  reasons: string[];
}

export function computeHealth(inputs: HealthInputs): HealthResult {
  const reasons: string[] = [];
  let score = inputs.workspaceRollupAverage != null ? Math.round(inputs.workspaceRollupAverage) : 100;

  if (inputs.hasActiveStuckEvent) {
    score -= 40;
    reasons.push("active_stuck_event");
  }
  if (inputs.costRatio != null && inputs.costRatio > 1.5) {
    score -= 20;
    reasons.push("cost_overrun");
  }
  if (inputs.recentKillEventInLast30Min) {
    score -= 15;
    reasons.push("recent_kill");
  }
  if (inputs.restartCount > 0) {
    const restartPenalty = Math.min(40, inputs.restartCount * 10);
    score -= restartPenalty;
    reasons.push(`restarts_${inputs.restartCount}`);
  }
  if (inputs.mcpCascadeOpen) {
    score -= 15;
    reasons.push("mcp_cascade_open");
  }
  if (inputs.recentDragInCount > 0) {
    const dragPenalty = Math.min(30, inputs.recentDragInCount * 5);
    score -= dragPenalty;
    reasons.push(`drag_in_${inputs.recentDragInCount}`);
  }

  score = Math.max(0, Math.min(100, score));

  let compositeState: CompositeState;
  if (score >= 90) compositeState = "healthy";
  else if (score >= 70) compositeState = "minor";
  else if (score >= 40) compositeState = "degraded";
  else compositeState = "critical";

  return { score, compositeState, reasons };
}
