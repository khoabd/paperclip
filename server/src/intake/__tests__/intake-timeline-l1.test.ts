import { describe, expect, it } from "vitest";
import { estimateL1 } from "../intake-timeline-l1.js";

describe("estimateL1", () => {
  it("returns null for passive feedback types", () => {
    expect(estimateL1("feedback_general", "P2")).toBeNull();
    expect(estimateL1("feedback_release", "P1")).toBeNull();
    expect(estimateL1("feedback_feature", "P3")).toBeNull();
  });

  it("matches the §6.2 brackets for problem", () => {
    expect(estimateL1("problem", "P0")).toEqual({
      p50Days: 1,
      p90Days: 3,
      rationale: "L1 bracket for problem/P0",
    });
    expect(estimateL1("problem", "P2")?.p90Days).toBe(14);
  });

  it("matches the §6.2 brackets for bug_report", () => {
    expect(estimateL1("bug_report", "P0")?.p50Days).toBe(0.5);
    expect(estimateL1("bug_report", "P1")?.p90Days).toBe(5);
  });

  it("uses wildcard bracket for strategic_input", () => {
    expect(estimateL1("strategic_input", "P0")).toEqual({
      p50Days: 1,
      p90Days: 3,
      rationale: "L1 bracket for strategic_input/P0",
    });
  });

  it("question always sub-day", () => {
    const q = estimateL1("question", "P3")!;
    expect(q.p50Days).toBeLessThan(1);
    expect(q.p90Days).toBeLessThan(1);
  });
});
