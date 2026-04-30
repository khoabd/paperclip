import { describe, expect, it } from "vitest";
import { computeHealth, type HealthInputs } from "../health-scorer.js";

function inputs(overrides: Partial<HealthInputs> = {}): HealthInputs {
  return {
    hasActiveStuckEvent: false,
    costRatio: null,
    recentKillEventInLast30Min: false,
    restartCount: 0,
    mcpCascadeOpen: false,
    recentDragInCount: 0,
    workspaceRollupAverage: null,
    ...overrides,
  };
}

describe("computeHealth", () => {
  it("a clean mission scores healthy at 100", () => {
    const r = computeHealth(inputs());
    expect(r.score).toBe(100);
    expect(r.compositeState).toBe("healthy");
    expect(r.reasons).toEqual([]);
  });

  it("active stuck event drops score by 40 → minor when alone", () => {
    const r = computeHealth(inputs({ hasActiveStuckEvent: true }));
    expect(r.score).toBe(60);
    expect(r.compositeState).toBe("degraded");
    expect(r.reasons).toContain("active_stuck_event");
  });

  it("cost overrun above 1.5 ratio penalizes 20", () => {
    const r = computeHealth(inputs({ costRatio: 2 }));
    expect(r.score).toBe(80);
  });

  it("cost ratio at or below 1.5 does not penalize", () => {
    const r = computeHealth(inputs({ costRatio: 1.5 }));
    expect(r.score).toBe(100);
  });

  it("restart count is capped at 40 penalty", () => {
    const r = computeHealth(inputs({ restartCount: 10 }));
    expect(r.score).toBe(60);
  });

  it("multiple penalties stack (clamped at 0)", () => {
    const r = computeHealth(
      inputs({
        hasActiveStuckEvent: true,
        costRatio: 2,
        recentKillEventInLast30Min: true,
        restartCount: 3,
        mcpCascadeOpen: true,
        recentDragInCount: 4,
      }),
    );
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.compositeState).toBe("critical");
  });

  it("workspace rollup uses provided average as the starting point", () => {
    const r = computeHealth(inputs({ workspaceRollupAverage: 75 }));
    expect(r.score).toBe(75);
    expect(r.compositeState).toBe("minor");
  });

  it("composite state thresholds match spec", () => {
    expect(computeHealth(inputs({ workspaceRollupAverage: 90 })).compositeState).toBe("healthy");
    expect(computeHealth(inputs({ workspaceRollupAverage: 70 })).compositeState).toBe("minor");
    expect(computeHealth(inputs({ workspaceRollupAverage: 40 })).compositeState).toBe("degraded");
    expect(computeHealth(inputs({ workspaceRollupAverage: 39 })).compositeState).toBe("critical");
  });
});
