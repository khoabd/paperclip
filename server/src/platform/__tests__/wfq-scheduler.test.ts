import { describe, expect, it } from "vitest";
import { WfqScheduler } from "../wfq-scheduler.js";

describe("WfqScheduler", () => {
  it("interleaves equal-weight workspaces fairly", () => {
    const sched = new WfqScheduler<string>();
    for (let i = 0; i < 4; i++) sched.enqueue({ workspaceId: "A", weight: 100, payload: `a${i}` });
    for (let i = 0; i < 4; i++) sched.enqueue({ workspaceId: "B", weight: 100, payload: `b${i}` });
    const order = sched.dispatch(8).map((p) => p.workspaceId);
    expect(order.filter((x) => x === "A")).toHaveLength(4);
    expect(order.filter((x) => x === "B")).toHaveLength(4);
    // No more than 2 of the same workspace ever in a row when weights are equal.
    let run = 1;
    for (let i = 1; i < order.length; i++) {
      if (order[i] === order[i - 1]) run++;
      else run = 1;
      expect(run).toBeLessThanOrEqual(2);
    }
  });

  it("gives a higher-weight workspace more turns over time", () => {
    const sched = new WfqScheduler<string>();
    for (let i = 0; i < 30; i++) sched.enqueue({ workspaceId: "high", weight: 300, payload: `h${i}` });
    for (let i = 0; i < 30; i++) sched.enqueue({ workspaceId: "low", weight: 100, payload: `l${i}` });
    const order = sched.dispatch(40).map((p) => p.workspaceId);
    const high = order.filter((x) => x === "high").length;
    const low = order.filter((x) => x === "low").length;
    expect(high).toBeGreaterThan(low);
  });

  it("never starves a single-job lane behind a heavy lane", () => {
    const sched = new WfqScheduler<string>();
    for (let i = 0; i < 50; i++) sched.enqueue({ workspaceId: "heavy", weight: 100, payload: `h${i}` });
    sched.enqueue({ workspaceId: "tiny", weight: 100, payload: "t0" });
    const order = sched.dispatch(50).map((p) => p.workspaceId);
    expect(order.includes("tiny")).toBe(true);
    expect(order.indexOf("tiny")).toBeLessThan(5);
  });

  it("skips empty lanes and still drains remaining work", () => {
    const sched = new WfqScheduler<string>();
    sched.enqueue({ workspaceId: "A", weight: 100, payload: "a" });
    sched.enqueue({ workspaceId: "B", weight: 100, payload: "b" });
    expect(sched.dispatch(5)).toHaveLength(2);
    expect(sched.size()).toBe(0);
    expect(sched.dispatch(5)).toHaveLength(0);
  });
});
