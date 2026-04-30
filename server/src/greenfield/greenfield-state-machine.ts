// Pure state graph for Greenfield Bootstrap. No I/O, no DB.
// Per Phase-8-Greenfield-Bootstrap §8.2 + ADR-0003.
//
// Intake statuses: pending | running | gate_pending | done | aborted
// Stage statuses:  pending | running | done | failed | gated
//
// 7 stages run sequentially:
//   idea_refinement (0) → market_research (1) → personas (2) → stack (3) →
//   brain (4) → repo_scaffold (5) → sprint1 (6)
//
// From any failed stage, recovery transitions: retry | alt_path | skip | abort

export type IntakeStatus = "pending" | "running" | "gate_pending" | "done" | "aborted";
export type StageStatus = "pending" | "running" | "done" | "failed" | "gated";
export type StageName =
  | "idea_refinement"
  | "market_research"
  | "personas"
  | "stack"
  | "brain"
  | "repo_scaffold"
  | "sprint1";
export type RecoveryKind = "retry" | "alt_path" | "skip" | "abort";

export const STAGE_SEQUENCE: StageName[] = [
  "idea_refinement",
  "market_research",
  "personas",
  "stack",
  "brain",
  "repo_scaffold",
  "sprint1",
];

export type TransitionVerdict = { ok: true } | { ok: false; reason: string };

// ── Stage-level transitions ────────────────────────────────────────────────

export interface StageTransitionInput {
  from: StageStatus;
  to: StageStatus;
}

/**
 * Legal forward stage transitions (runner-driven):
 *   pending  → running
 *   running  → done | failed | gated
 *   gated    → running  (approval resolved)
 *   failed   → (only via recovery — not a direct forward transition)
 *   done     → (terminal)
 */
export function canTransitionStage(input: StageTransitionInput): TransitionVerdict {
  const { from, to } = input;
  if (from === to) return { ok: false, reason: "same status" };

  const FORWARD: Record<StageStatus, StageStatus[]> = {
    pending: ["running"],
    running: ["done", "failed", "gated"],
    done: [],
    failed: [],
    gated: ["running"],
  };

  if (!FORWARD[from].includes(to)) {
    return { ok: false, reason: `stage cannot move ${from} → ${to}` };
  }
  return { ok: true };
}

// ── Recovery transitions ───────────────────────────────────────────────────

export interface RecoveryTransitionInput {
  stageStatus: StageStatus;
  kind: RecoveryKind;
}

/**
 * Valid recovery kinds for a failed stage:
 *   retry    → stage back to pending
 *   alt_path → stage back to pending (different runner variant)
 *   skip     → stage done with empty outputs
 *   abort    → intake aborted
 *
 * Only applicable when stageStatus === 'failed'.
 */
export function canApplyRecovery(input: RecoveryTransitionInput): TransitionVerdict {
  const { stageStatus, kind } = input;
  if (stageStatus !== "failed") {
    return { ok: false, reason: `recovery only applies to failed stages, got ${stageStatus}` };
  }
  const LEGAL_KINDS: RecoveryKind[] = ["retry", "alt_path", "skip", "abort"];
  if (!LEGAL_KINDS.includes(kind)) {
    return { ok: false, reason: `unknown recovery kind: ${kind}` };
  }
  return { ok: true };
}

/** What stage status results after a recovery action? */
export function recoveryResultStageStatus(kind: RecoveryKind): StageStatus {
  if (kind === "skip") return "done";
  if (kind === "abort") return "failed"; // intake is aborted, stage stays failed
  return "pending"; // retry | alt_path
}

// ── Intake-level transitions ───────────────────────────────────────────────

export interface IntakeTransitionInput {
  from: IntakeStatus;
  to: IntakeStatus;
  /** Present when the transition is triggered by a stage event. */
  trigger?:
    | "stage_started"
    | "gate_opened"
    | "gate_resolved"
    | "all_stages_done"
    | "abort_recovery";
}

/**
 * Legal intake-level transitions:
 *   pending      → running        (first tick)
 *   running      → gate_pending   (a stage opened a gate)
 *   running      → done           (sprint1 done)
 *   running      → aborted        (abort recovery)
 *   gate_pending → running        (gate resolved / approved)
 *   gate_pending → aborted        (gate rejected → abort)
 */
export function canTransitionIntake(input: IntakeTransitionInput): TransitionVerdict {
  const { from, to } = input;
  if (from === to) return { ok: false, reason: "same status" };

  const FORWARD: Record<IntakeStatus, IntakeStatus[]> = {
    pending: ["running"],
    running: ["gate_pending", "done", "aborted"],
    gate_pending: ["running", "aborted"],
    done: [],
    aborted: [],
  };

  if (!FORWARD[from].includes(to)) {
    return { ok: false, reason: `intake cannot move ${from} → ${to}` };
  }
  return { ok: true };
}

export function isTerminalIntake(status: IntakeStatus): boolean {
  return status === "done" || status === "aborted";
}

export function isTerminalStage(status: StageStatus): boolean {
  return status === "done" || status === "failed";
}
