// Pure state graph for design document lifecycle. No I/O, no DB.
// Per Phase-7-Development-Flow-Feature-Flags §7.2 — mirrors mission-state-machine.ts style.

export type DesignDocStatus =
  | "proposed"
  | "review"
  | "approved"
  | "in_dev"
  | "live"
  | "archived";

export type DesignDocActor = "runner" | "user";

export interface DesignDocTransitionInput {
  from: DesignDocStatus;
  to: DesignDocStatus;
  actor: DesignDocActor;
  ctx: {
    /** True when there are no open (unresolved) conflict_events for this doc. */
    noOpenConflicts: boolean;
    /** True when the associated feature flag is at status='on' OR rollout_percent=100. */
    featureFlagLive: boolean;
  };
}

export type DesignDocTransitionVerdict =
  | { ok: true }
  | { ok: false; reason: string };

// Runner-driven transitions (automated lifecycle progress).
const RUNNER_ALLOWED: Record<DesignDocStatus, DesignDocStatus[]> = {
  proposed: ["review"],
  review: ["approved", "proposed"],
  approved: ["in_dev"],
  in_dev: ["live"],
  live: ["archived"],
  archived: [],
};

// User can force archive from any state.
const USER_FORCE_ARCHIVE: DesignDocStatus[] = [
  "proposed",
  "review",
  "approved",
  "in_dev",
  "live",
];

export function canTransitionDesignDoc(
  input: DesignDocTransitionInput,
): DesignDocTransitionVerdict {
  const { from, to, actor, ctx } = input;

  if (from === to) return { ok: false, reason: "same status" };

  // User can force archive from any non-archived state.
  if (actor === "user" && to === "archived") {
    if (!USER_FORCE_ARCHIVE.includes(from)) {
      return { ok: false, reason: "already archived" };
    }
    return { ok: true };
  }

  if (actor !== "runner") {
    return { ok: false, reason: `user cannot move ${from}->${to} (only force-archive allowed)` };
  }

  const allowed = RUNNER_ALLOWED[from];
  if (!allowed.includes(to)) {
    return { ok: false, reason: `runner cannot move ${from}->${to}` };
  }

  switch (`${from}->${to}`) {
    case "proposed->review":
      return { ok: true };
    case "review->approved":
      return ctx.noOpenConflicts
        ? { ok: true }
        : { ok: false, reason: "cannot approve: open conflicts exist" };
    case "review->proposed":
      // Runner moves back to proposed on revision (re-review needed).
      return { ok: true };
    case "approved->in_dev":
      return { ok: true };
    case "in_dev->live":
      return ctx.featureFlagLive
        ? { ok: true }
        : { ok: false, reason: "feature flag must be on or at 100% rollout before going live" };
    case "live->archived":
      return { ok: true };
    default:
      return { ok: false, reason: `unhandled ${from}->${to}` };
  }
}

export function legalRunnerTargets(from: DesignDocStatus): DesignDocStatus[] {
  return RUNNER_ALLOWED[from] ?? [];
}
