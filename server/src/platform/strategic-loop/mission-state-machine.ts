// Pure state graph for the strategic loop. No I/O, no DB.
// Per Phase-4-Strategic-Loop-Foundation §4.2.

export type MissionStatus =
  | "intake"
  | "planning"
  | "executing"
  | "reflecting"
  | "blocked"
  | "done";

export type Actor = "runner" | "user";

export interface TransitionInput {
  from: MissionStatus;
  to: MissionStatus;
  actor: Actor;
  /** Aggregate state used by guards: do we have queued steps? are all steps done? did one fail? */
  ctx: {
    queuedSteps: number;
    runningSteps: number;
    pendingSteps: number;
    failedSteps: number;
    doneSteps: number;
    reflectorWantsDone: boolean;
    reflectorWantsReplan: boolean;
    gateTimedOut: boolean;
  };
}

export type TransitionVerdict =
  | { ok: true }
  | { ok: false; reason: string };

const TERMINAL: MissionStatus[] = ["done"];

export function isTerminal(status: MissionStatus): boolean {
  return TERMINAL.includes(status);
}

const RUNNER_ALLOWED: Record<MissionStatus, MissionStatus[]> = {
  intake: ["planning"],
  planning: ["executing"],
  executing: ["reflecting", "blocked"],
  reflecting: ["planning", "done", "blocked"],
  blocked: [],
  done: [],
};

const USER_ALLOWED: Record<MissionStatus, MissionStatus[]> = {
  intake: [],
  planning: [],
  executing: [],
  reflecting: [],
  blocked: ["planning"],
  done: [],
};

export function canTransition(input: TransitionInput): TransitionVerdict {
  const { from, to, actor, ctx } = input;
  if (from === to) return { ok: false, reason: "same status" };
  const allowed = (actor === "runner" ? RUNNER_ALLOWED : USER_ALLOWED)[from];
  if (!allowed.includes(to)) return { ok: false, reason: `${actor} cannot move ${from}->${to}` };

  // gate-timeout escape hatch — runner can always force into blocked from any non-terminal status.
  if (ctx.gateTimedOut && to === "blocked" && actor === "runner") return { ok: true };

  switch (`${from}->${to}`) {
    case "intake->planning":
      return { ok: true };
    case "planning->executing":
      return ctx.queuedSteps + ctx.pendingSteps > 0
        ? { ok: true }
        : { ok: false, reason: "no steps queued" };
    case "executing->reflecting":
      return ctx.queuedSteps + ctx.pendingSteps + ctx.runningSteps === 0
        ? { ok: true }
        : { ok: false, reason: "still queued, pending, or running steps" };
    case "executing->blocked":
      return ctx.failedSteps > 0
        ? { ok: true }
        : { ok: false, reason: "no failed steps" };
    case "reflecting->planning":
      return ctx.reflectorWantsReplan
        ? { ok: true }
        : { ok: false, reason: "reflector did not request replan" };
    case "reflecting->done":
      return ctx.reflectorWantsDone
        ? { ok: true }
        : { ok: false, reason: "reflector did not signal done" };
    case "reflecting->blocked":
      return ctx.gateTimedOut
        ? { ok: true }
        : { ok: false, reason: "no timeout to justify block" };
    case "blocked->planning":
      return { ok: true };
    default:
      return { ok: false, reason: `unhandled ${from}->${to}` };
  }
}

export function legalRunnerTargets(from: MissionStatus): MissionStatus[] {
  return RUNNER_ALLOWED[from] ?? [];
}

export function legalUserTargets(from: MissionStatus): MissionStatus[] {
  return USER_ALLOWED[from] ?? [];
}
