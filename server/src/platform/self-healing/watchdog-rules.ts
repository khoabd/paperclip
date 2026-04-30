// Pure rule evaluation for the self-healing watchdog.
// Each rule takes a synthetic ctx and returns either a StuckEventDraft or null.
// Per Phase-6-Self-Healing-Extension §6.2.

export type WatchdogRule =
  | "stalled"
  | "infinite_loop"
  | "deadlock"
  | "cost_runaway"
  | "mcp_cascade"
  | "state_corruption"
  | "drag_in";

export interface WatchdogCtx {
  missionId: string;
  companyId: string;
  /** Last heartbeat sentAt; null if no heartbeat ever recorded. */
  lastHeartbeatAt: Date | null;
  /** Heartbeat state, when known. */
  lastState: string | null;
  /** Tool calls (current_tool values) emitted in the last 5 min. */
  recentToolCalls: string[];
  /** Predicted vs actual cost ratio: actual ÷ predicted. null if no prediction. */
  costRatio: number | null;
  /** Absolute cost so far for floor check. */
  costSoFarUsd: number | null;
  /** True if the heartbeat says we are waiting on something currently. */
  hasWaitingOnCycle: boolean;
  /** Last progress marker; used for state_corruption sniff. */
  progressMarker: string | null;
  /** True if more than gateQuotaPerWeek approvals are pending > 24h. */
  approvalQueueOverflow: boolean;
  /** Intake volume vs gate quota (per week). null if not measured this run. */
  intakeVolumeRatio: number | null;
  now: Date;
}

export interface StuckEventDraft {
  rule: WatchdogRule;
  diagnosis: Record<string, unknown>;
  evidence: Record<string, unknown>;
  /** Suggested auto-action; the watchdog runner is responsible for applying it. */
  suggestedAutoAction:
    | "ping_then_restart"
    | "kill_immediate"
    | "kill_cycle"
    | "pause_and_snapshot"
    | "circuit_break"
    | "restore_checkpoint"
    | "observe_only";
}

const STALLED_THRESHOLD_MIN = 5;
const INFINITE_LOOP_THRESHOLD = 10;
const COST_RUNAWAY_RATIO = 2;
const COST_RUNAWAY_FLOOR_USD = 5;
const INTAKE_VOLUME_DRAG_RATIO = 2;

export function evaluateRules(ctx: WatchdogCtx): StuckEventDraft[] {
  const out: StuckEventDraft[] = [];
  const stalled = ruleStalled(ctx);
  if (stalled) out.push(stalled);
  const loop = ruleInfiniteLoop(ctx);
  if (loop) out.push(loop);
  const dl = ruleDeadlock(ctx);
  if (dl) out.push(dl);
  const cost = ruleCostRunaway(ctx);
  if (cost) out.push(cost);
  // Rules 5/6 are detect-only stubs in Phase 6.
  const corr = ruleStateCorruption(ctx);
  if (corr) out.push(corr);
  const drag = ruleDragIn(ctx);
  if (drag) out.push(drag);
  return out;
}

function ruleStalled(ctx: WatchdogCtx): StuckEventDraft | null {
  if (ctx.lastState !== "active" || !ctx.lastHeartbeatAt) return null;
  const elapsedMin = (ctx.now.getTime() - ctx.lastHeartbeatAt.getTime()) / 60_000;
  if (elapsedMin <= STALLED_THRESHOLD_MIN) return null;
  return {
    rule: "stalled",
    diagnosis: {
      lastHeartbeatAt: ctx.lastHeartbeatAt.toISOString(),
      elapsedMin: Number(elapsedMin.toFixed(2)),
      threshold: STALLED_THRESHOLD_MIN,
    },
    evidence: { progressMarker: ctx.progressMarker },
    suggestedAutoAction: "ping_then_restart",
  };
}

function ruleInfiniteLoop(ctx: WatchdogCtx): StuckEventDraft | null {
  const counts = new Map<string, number>();
  for (const t of ctx.recentToolCalls) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let worst: { tool: string; count: number } | null = null;
  for (const [tool, count] of counts) {
    if (count >= INFINITE_LOOP_THRESHOLD && (!worst || count > worst.count)) {
      worst = { tool, count };
    }
  }
  if (!worst) return null;
  return {
    rule: "infinite_loop",
    diagnosis: { tool: worst.tool, count: worst.count, threshold: INFINITE_LOOP_THRESHOLD },
    evidence: { recentToolCalls: ctx.recentToolCalls.slice(-50) },
    suggestedAutoAction: "kill_immediate",
  };
}

function ruleDeadlock(ctx: WatchdogCtx): StuckEventDraft | null {
  if (!ctx.hasWaitingOnCycle) return null;
  return {
    rule: "deadlock",
    diagnosis: { detected: true },
    evidence: {},
    suggestedAutoAction: "kill_cycle",
  };
}

function ruleCostRunaway(ctx: WatchdogCtx): StuckEventDraft | null {
  if (ctx.costRatio == null || ctx.costSoFarUsd == null) return null;
  if (ctx.costRatio < COST_RUNAWAY_RATIO) return null;
  if (ctx.costSoFarUsd < COST_RUNAWAY_FLOOR_USD) return null;
  return {
    rule: "cost_runaway",
    diagnosis: {
      costRatio: ctx.costRatio,
      costSoFarUsd: ctx.costSoFarUsd,
      ratioThreshold: COST_RUNAWAY_RATIO,
      floorUsd: COST_RUNAWAY_FLOOR_USD,
    },
    evidence: {},
    suggestedAutoAction: "pause_and_snapshot",
  };
}

function ruleStateCorruption(ctx: WatchdogCtx): StuckEventDraft | null {
  if (!ctx.progressMarker?.startsWith("invariant_violation")) return null;
  return {
    rule: "state_corruption",
    diagnosis: { progressMarker: ctx.progressMarker },
    evidence: {},
    suggestedAutoAction: "restore_checkpoint",
  };
}

function ruleDragIn(ctx: WatchdogCtx): StuckEventDraft | null {
  const reasons: string[] = [];
  if (ctx.approvalQueueOverflow) reasons.push("approval_queue_overflow");
  if (ctx.intakeVolumeRatio != null && ctx.intakeVolumeRatio >= INTAKE_VOLUME_DRAG_RATIO) {
    reasons.push("intake_volume_overload");
  }
  if (reasons.length === 0) return null;
  return {
    rule: "drag_in",
    diagnosis: { reasons, intakeVolumeRatio: ctx.intakeVolumeRatio },
    evidence: {},
    suggestedAutoAction: "observe_only",
  };
}
