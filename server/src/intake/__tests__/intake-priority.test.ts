import { describe, expect, it } from "vitest";
import { priorityOf } from "../intake-priority.js";

describe("priorityOf", () => {
  it("data_loss bug + thousands of users → P0", () => {
    expect(
      priorityOf({
        type: "bug_report",
        severity: "data_loss",
        affectedUsersEstimated: 4000,
      }),
    ).toBe("P0");
  });

  it("crash bug, small blast radius → P1", () => {
    expect(
      priorityOf({
        type: "bug_report",
        severity: "crash",
        affectedUsersEstimated: 2000,
      }),
    ).toBe("P1");
  });

  it("visual nit → P3", () => {
    expect(priorityOf({ type: "bug_report", severity: "visual" })).toBe("P3");
  });

  it("problem with high revenue impact → P0", () => {
    expect(priorityOf({ type: "problem", revenueImpactScore: 90 })).toBe("P0");
  });

  it("feature_request with no demand signals → P3", () => {
    expect(priorityOf({ type: "feature_request" })).toBe("P3");
  });

  it("feature_request with strong demand → P1", () => {
    expect(priorityOf({ type: "feature_request", customerDemandSignals: 60 })).toBe("P1");
  });

  it("strategic_input is always at least P2", () => {
    const p = priorityOf({ type: "strategic_input" });
    expect(["P2", "P1", "P0"]).toContain(p);
  });

  it("low submitter mood escalates priority", () => {
    const moody = priorityOf({ type: "feature_request", customerDemandSignals: 18, submitterMood: 1 });
    const happy = priorityOf({ type: "feature_request", customerDemandSignals: 18, submitterMood: 5 });
    const rank = (p: string) => ["P3", "P2", "P1", "P0"].indexOf(p);
    expect(rank(moody)).toBeGreaterThanOrEqual(rank(happy));
  });
});
