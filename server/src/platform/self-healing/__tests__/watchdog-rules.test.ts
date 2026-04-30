import { describe, expect, it } from "vitest";
import { evaluateRules, type WatchdogCtx } from "../watchdog-rules.js";

function ctx(overrides: Partial<WatchdogCtx> = {}): WatchdogCtx {
  return {
    missionId: "m-1",
    companyId: "c-1",
    lastHeartbeatAt: new Date("2026-04-29T10:00:00Z"),
    lastState: "active",
    recentToolCalls: [],
    costRatio: null,
    costSoFarUsd: null,
    hasWaitingOnCycle: false,
    progressMarker: null,
    approvalQueueOverflow: false,
    intakeVolumeRatio: null,
    now: new Date("2026-04-29T10:01:00Z"),
    ...overrides,
  };
}

describe("watchdog-rules", () => {
  it("stalled fires after 5 minutes of silence on an active mission", () => {
    const r = evaluateRules(
      ctx({ now: new Date("2026-04-29T10:06:01Z") }),
    );
    expect(r.find((x) => x.rule === "stalled")).toBeDefined();
  });

  it("stalled does not fire on a non-active mission", () => {
    const r = evaluateRules(
      ctx({ lastState: "completed", now: new Date("2026-04-29T10:30:00Z") }),
    );
    expect(r.find((x) => x.rule === "stalled")).toBeUndefined();
  });

  it("infinite_loop fires when same tool ≥ 10 in 5 min", () => {
    const tools = Array.from({ length: 10 }, () => "git_diff");
    const r = evaluateRules(ctx({ recentToolCalls: tools }));
    const hit = r.find((x) => x.rule === "infinite_loop");
    expect(hit).toBeDefined();
    expect((hit!.diagnosis as { tool: string }).tool).toBe("git_diff");
  });

  it("infinite_loop does not fire below threshold", () => {
    const tools = Array.from({ length: 9 }, () => "git_diff");
    const r = evaluateRules(ctx({ recentToolCalls: tools }));
    expect(r.find((x) => x.rule === "infinite_loop")).toBeUndefined();
  });

  it("deadlock fires when ctx flag is set", () => {
    const r = evaluateRules(ctx({ hasWaitingOnCycle: true }));
    expect(r.find((x) => x.rule === "deadlock")).toBeDefined();
  });

  it("cost_runaway requires ratio ≥ 2 AND floor $5", () => {
    expect(
      evaluateRules(ctx({ costRatio: 3, costSoFarUsd: 4 })).find((x) => x.rule === "cost_runaway"),
    ).toBeUndefined();
    expect(
      evaluateRules(ctx({ costRatio: 1.9, costSoFarUsd: 50 })).find(
        (x) => x.rule === "cost_runaway",
      ),
    ).toBeUndefined();
    const hit = evaluateRules(ctx({ costRatio: 2.5, costSoFarUsd: 12 })).find(
      (x) => x.rule === "cost_runaway",
    );
    expect(hit).toBeDefined();
    expect(hit!.suggestedAutoAction).toBe("pause_and_snapshot");
  });

  it("state_corruption fires on invariant_violation progress marker", () => {
    const hit = evaluateRules(ctx({ progressMarker: "invariant_violation:foo" })).find(
      (x) => x.rule === "state_corruption",
    );
    expect(hit).toBeDefined();
  });

  it("drag_in fires on intake volume overload OR approval queue overflow", () => {
    const a = evaluateRules(ctx({ intakeVolumeRatio: 2.5 }));
    expect(a.find((x) => x.rule === "drag_in")).toBeDefined();
    const b = evaluateRules(ctx({ approvalQueueOverflow: true }));
    expect(b.find((x) => x.rule === "drag_in")).toBeDefined();
    const c = evaluateRules(ctx({ intakeVolumeRatio: 1.5 }));
    expect(c.find((x) => x.rule === "drag_in")).toBeUndefined();
  });

  it("a healthy ctx triggers no rules", () => {
    expect(evaluateRules(ctx())).toEqual([]);
  });
});
