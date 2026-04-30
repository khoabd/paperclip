import { describe, expect, it } from "vitest";
import {
  canTransition,
  isTerminal,
  legalRunnerTargets,
  legalUserTargets,
  type MissionStatus,
  type TransitionInput,
} from "../mission-state-machine.js";

const ALL: MissionStatus[] = ["intake", "planning", "executing", "reflecting", "blocked", "done"];

function ctx(overrides: Partial<TransitionInput["ctx"]> = {}): TransitionInput["ctx"] {
  return {
    queuedSteps: 0,
    runningSteps: 0,
    pendingSteps: 0,
    failedSteps: 0,
    doneSteps: 0,
    reflectorWantsDone: false,
    reflectorWantsReplan: false,
    gateTimedOut: false,
    ...overrides,
  };
}

describe("MissionStateMachine", () => {
  it("rejects same-status transitions", () => {
    for (const s of ALL) {
      expect(canTransition({ from: s, to: s, actor: "runner", ctx: ctx() }).ok).toBe(false);
    }
  });

  it("intake → planning is always legal for runner", () => {
    expect(canTransition({ from: "intake", to: "planning", actor: "runner", ctx: ctx() }).ok).toBe(
      true,
    );
  });

  it("planning → executing requires queued or pending steps", () => {
    expect(
      canTransition({ from: "planning", to: "executing", actor: "runner", ctx: ctx() }).ok,
    ).toBe(false);
    expect(
      canTransition({
        from: "planning",
        to: "executing",
        actor: "runner",
        ctx: ctx({ queuedSteps: 2 }),
      }).ok,
    ).toBe(true);
    expect(
      canTransition({
        from: "planning",
        to: "executing",
        actor: "runner",
        ctx: ctx({ pendingSteps: 1 }),
      }).ok,
    ).toBe(true);
  });

  it("executing → reflecting requires no queued, pending, or running steps", () => {
    expect(
      canTransition({
        from: "executing",
        to: "reflecting",
        actor: "runner",
        ctx: ctx({ queuedSteps: 1 }),
      }).ok,
    ).toBe(false);
    expect(
      canTransition({
        from: "executing",
        to: "reflecting",
        actor: "runner",
        ctx: ctx({ pendingSteps: 1 }),
      }).ok,
    ).toBe(false);
    expect(
      canTransition({
        from: "executing",
        to: "reflecting",
        actor: "runner",
        ctx: ctx({ runningSteps: 1 }),
      }).ok,
    ).toBe(false);
    expect(
      canTransition({
        from: "executing",
        to: "reflecting",
        actor: "runner",
        ctx: ctx({ doneSteps: 3 }),
      }).ok,
    ).toBe(true);
  });

  it("executing → blocked requires at least one failed step (or gate timeout)", () => {
    expect(
      canTransition({ from: "executing", to: "blocked", actor: "runner", ctx: ctx() }).ok,
    ).toBe(false);
    expect(
      canTransition({
        from: "executing",
        to: "blocked",
        actor: "runner",
        ctx: ctx({ failedSteps: 1 }),
      }).ok,
    ).toBe(true);
    expect(
      canTransition({
        from: "executing",
        to: "blocked",
        actor: "runner",
        ctx: ctx({ gateTimedOut: true }),
      }).ok,
    ).toBe(true);
  });

  it("reflecting → done requires reflectorWantsDone", () => {
    expect(
      canTransition({ from: "reflecting", to: "done", actor: "runner", ctx: ctx() }).ok,
    ).toBe(false);
    expect(
      canTransition({
        from: "reflecting",
        to: "done",
        actor: "runner",
        ctx: ctx({ reflectorWantsDone: true }),
      }).ok,
    ).toBe(true);
  });

  it("reflecting → planning requires reflectorWantsReplan", () => {
    expect(
      canTransition({ from: "reflecting", to: "planning", actor: "runner", ctx: ctx() }).ok,
    ).toBe(false);
    expect(
      canTransition({
        from: "reflecting",
        to: "planning",
        actor: "runner",
        ctx: ctx({ reflectorWantsReplan: true }),
      }).ok,
    ).toBe(true);
  });

  it("reflecting → blocked requires gateTimedOut", () => {
    expect(
      canTransition({ from: "reflecting", to: "blocked", actor: "runner", ctx: ctx() }).ok,
    ).toBe(false);
    expect(
      canTransition({
        from: "reflecting",
        to: "blocked",
        actor: "runner",
        ctx: ctx({ gateTimedOut: true }),
      }).ok,
    ).toBe(true);
  });

  it("only the user can move blocked → planning", () => {
    expect(
      canTransition({ from: "blocked", to: "planning", actor: "user", ctx: ctx() }).ok,
    ).toBe(true);
    expect(
      canTransition({ from: "blocked", to: "planning", actor: "runner", ctx: ctx() }).ok,
    ).toBe(false);
  });

  it("done is terminal — every outgoing transition is illegal", () => {
    expect(isTerminal("done")).toBe(true);
    for (const to of ALL) {
      if (to === "done") continue;
      expect(
        canTransition({ from: "done", to, actor: "runner", ctx: ctx({ reflectorWantsDone: true }) })
          .ok,
      ).toBe(false);
      expect(canTransition({ from: "done", to, actor: "user", ctx: ctx() }).ok).toBe(false);
    }
  });

  it("rejects every illegal directed pair (runner)", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        if (from === to) continue;
        const isLegalEdge = legalRunnerTargets(from).includes(to);
        if (!isLegalEdge) {
          expect(
            canTransition({
              from,
              to,
              actor: "runner",
              ctx: ctx({
                queuedSteps: 1,
                pendingSteps: 1,
                doneSteps: 1,
                failedSteps: 1,
                reflectorWantsDone: true,
                reflectorWantsReplan: true,
              }),
            }).ok,
          ).toBe(false);
        }
      }
    }
  });

  it("user actor cannot drive the runner-only transitions", () => {
    expect(
      canTransition({ from: "intake", to: "planning", actor: "user", ctx: ctx() }).ok,
    ).toBe(false);
    expect(
      canTransition({
        from: "planning",
        to: "executing",
        actor: "user",
        ctx: ctx({ queuedSteps: 1 }),
      }).ok,
    ).toBe(false);
  });

  it("legal*Targets matches the allow tables", () => {
    expect(legalRunnerTargets("intake")).toEqual(["planning"]);
    expect(legalRunnerTargets("planning")).toEqual(["executing"]);
    expect(legalRunnerTargets("executing")).toEqual(["reflecting", "blocked"]);
    expect(legalRunnerTargets("reflecting")).toEqual(["planning", "done", "blocked"]);
    expect(legalRunnerTargets("done")).toEqual([]);
    expect(legalUserTargets("blocked")).toEqual(["planning"]);
  });
});
