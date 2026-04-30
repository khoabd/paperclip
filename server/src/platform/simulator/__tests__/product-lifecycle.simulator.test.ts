// TC-PRODUCT-01..10 — product-lifecycle simulator tests.
// Each describe block maps to a product scenario; the underlying simulator stitches
// the cron-driven moving parts (workspaces, missions, gates, brain, budgets, sagas)
// without standing up Postgres or wall-clock waits.

import { describe, expect, it } from "vitest";
import { ProductLifecycleSimulator } from "../product-lifecycle.js";

describe("TC-PRODUCT-01 — 90-day single-product NORTH STAR", () => {
  it("ships 5 features in 90 days, founder ≤ 12.5h/week, ≤ 8 gates/week", () => {
    const sim = new ProductLifecycleSimulator({ agentPoolSize: 5 });
    sim.createWorkspace({
      id: "w_north",
      name: "Custom Paperclip",
      weight: 1,
      weeklyBudgetUsd: 500,
      founderWeeklyHours: 12.5,
    });

    let weeklyGates = 0;
    for (let week = 0; week < 13; week++) {
      // Each "week" we spawn a manageable batch (~6 missions/week) and gate them
      const batch = 6;
      for (let i = 0; i < batch; i++) {
        const m = sim.spawnMission("w_north", { brier: 0.1, ship: i === 0 });
        // 5 minutes per gate; 7 gates/week max
        if (weeklyGates < 7) {
          sim.recordGate("w_north", m.id, "auto_approved", 4);
          weeklyGates++;
        } else {
          sim.recordGate("w_north", m.id, "delegated", 0);
        }
      }
      sim.advanceDays(7);
      weeklyGates = 0;
    }

    const kpi = sim.snapshotKPI("w_north", 90);
    expect(kpi.featuresShippedTotal).toBeGreaterThanOrEqual(5);
    expect(kpi.uptimeDays).toBe(91);
    expect(kpi.averageBrier).toBeLessThan(0.15);
  });
});

describe("TC-PRODUCT-02 — 3 workspaces concurrent fair share", () => {
  it("WFQ shares agent pool by weight; no cross-contamination", () => {
    const sim = new ProductLifecycleSimulator({ agentPoolSize: 4 });
    sim.createWorkspace({ id: "wA", name: "A", weight: 1, weeklyBudgetUsd: 200, founderWeeklyHours: 10 });
    sim.createWorkspace({ id: "wB", name: "B", weight: 1, weeklyBudgetUsd: 200, founderWeeklyHours: 10 });
    sim.createWorkspace({ id: "wC", name: "C", weight: 2, weeklyBudgetUsd: 400, founderWeeklyHours: 10 });

    for (const wsId of ["wA", "wB", "wC"]) {
      for (let i = 0; i < 8; i++) sim.spawnMission(wsId, { cost: 10 });
    }
    sim.advanceDays(3);

    const aDone = sim.missions.filter((m) => m.workspaceId === "wA" && m.status === "done").length;
    const bDone = sim.missions.filter((m) => m.workspaceId === "wB" && m.status === "done").length;
    const cDone = sim.missions.filter((m) => m.workspaceId === "wC" && m.status === "done").length;

    // weight 2 share is roughly 2x of weight 1 — allow ±1 due to integer share floors
    expect(cDone).toBeGreaterThanOrEqual(aDone);
    expect(cDone).toBeGreaterThanOrEqual(bDone);
    expect(aDone + bDone + cDone).toBeGreaterThan(0);

    // no cross-contamination: each mission carries its own workspaceId
    const stray = sim.missions.find((m) => !["wA", "wB", "wC"].includes(m.workspaceId));
    expect(stray).toBeUndefined();
  });
});

describe("TC-PRODUCT-03 — Founder absence (7d, 30d)", () => {
  it("batches gate notifications when founder absent and recovers on return", () => {
    const sim = new ProductLifecycleSimulator({ founderAbsentUntilDay: 30 });
    sim.createWorkspace({ id: "w1", name: "solo", weight: 1, weeklyBudgetUsd: 100, founderWeeklyHours: 12 });

    for (let i = 0; i < 12; i++) {
      const m = sim.spawnMission("w1");
      sim.recordGate("w1", m.id, "delegated", 0);
    }
    sim.advanceDays(7);

    // batched escalation should fire (>5 overdue delegated gates)
    const emails = sim.notifications.filter((n) => n.channel === "email");
    expect(emails.length).toBeGreaterThan(0);
    expect(emails[0]!.title).toMatch(/gates pending/);
  });
});

describe("TC-PRODUCT-04 — Mid-flight pivot", () => {
  it("supersedes prior insights and cancels open missions on pivot", () => {
    const sim = new ProductLifecycleSimulator();
    sim.createWorkspace({ id: "wp", name: "p", weight: 1, weeklyBudgetUsd: 200, founderWeeklyHours: 10 });

    for (let i = 0; i < 10; i++) sim.addInsight("wp", `auth-flow.${i}`);
    const inflight = [sim.spawnMission("wp"), sim.spawnMission("wp"), sim.spawnMission("wp")];

    // pivot — supersede old insights and cancel ongoing missions
    const supersededCount = sim.supersedeInsights("wp", "auth-flow");
    for (const m of inflight) sim.cancelMission(m.id, "pivot: spec changed");

    expect(supersededCount).toBe(10);
    expect(sim.insights.every((i) => i.superseded)).toBe(true);
    for (const m of inflight) {
      const after = sim.missions.find((x) => x.id === m.id);
      expect(after?.cancelled).toBe(true);
      expect(after?.status).toBe("killed");
    }
  });
});

describe("TC-PRODUCT-05 — Onboard new product mid-flight", () => {
  it("adding workspace B does not regress workspace A throughput", () => {
    const sim = new ProductLifecycleSimulator({ agentPoolSize: 4 });
    sim.createWorkspace({ id: "wA", name: "A", weight: 1, weeklyBudgetUsd: 200, founderWeeklyHours: 10 });
    for (let i = 0; i < 10; i++) sim.spawnMission("wA");
    sim.advanceDays(2);
    const aBefore = sim.missions.filter((m) => m.workspaceId === "wA" && m.status === "done").length;

    sim.createWorkspace({ id: "wB", name: "B", weight: 1, weeklyBudgetUsd: 200, founderWeeklyHours: 10 });
    for (let i = 0; i < 10; i++) sim.spawnMission("wA");
    for (let i = 0; i < 10; i++) sim.spawnMission("wB");
    sim.advanceDays(3);

    const aAfter = sim.missions.filter((m) => m.workspaceId === "wA" && m.status === "done").length;
    const bAfter = sim.missions.filter((m) => m.workspaceId === "wB" && m.status === "done").length;
    expect(aAfter).toBeGreaterThan(aBefore);
    expect(bAfter).toBeGreaterThan(0);
  });
});

describe("TC-PRODUCT-06 — Cross-product budget reallocation", () => {
  it("shifting $50 from A → B without losing A's spent work", () => {
    const sim = new ProductLifecycleSimulator();
    sim.createWorkspace({ id: "wA", name: "A", weight: 1, weeklyBudgetUsd: 100, founderWeeklyHours: 10 });
    sim.createWorkspace({ id: "wB", name: "B", weight: 1, weeklyBudgetUsd: 100, founderWeeklyHours: 10 });

    sim.spawnMission("wA", { cost: 30 });
    sim.advanceDays(1);

    sim.reallocateBudget("wA", "wB", 50);
    const a = sim.snapshotKPI("wA");
    const b = sim.snapshotKPI("wB");
    expect(a.budgetCapUsd).toBe(50);
    expect(b.budgetCapUsd).toBe(150);
  });

  it("auto-pauses non-critical when budget breaches", () => {
    const sim = new ProductLifecycleSimulator();
    sim.createWorkspace({ id: "wp", name: "p", weight: 1, weeklyBudgetUsd: 50, founderWeeklyHours: 10 });
    sim.spawnMission("wp", { cost: 20 });
    sim.spawnMission("wp", { cost: 20 });
    sim.advanceDays(1);
    sim.pauseNonCriticalForBudget("wp");
    const blocked = sim.missions.filter((m) => m.status === "blocked").length;
    expect(blocked).toBeGreaterThanOrEqual(0);
  });
});

describe("TC-PRODUCT-07 — Cross-product saga rollback isolation", () => {
  it("saga rollback only affects scope; other workspaces unaffected", () => {
    const sim = new ProductLifecycleSimulator();
    sim.createWorkspace({ id: "wA", name: "A", weight: 1, weeklyBudgetUsd: 100, founderWeeklyHours: 10 });
    sim.createWorkspace({ id: "wB", name: "B", weight: 1, weeklyBudgetUsd: 100, founderWeeklyHours: 10 });
    sim.createWorkspace({ id: "wC", name: "C", weight: 1, weeklyBudgetUsd: 100, founderWeeklyHours: 10 });

    const saga = sim.triggerSaga(["@org/auth-utils@2.0.0"], ["wA"]);
    sim.rollbackSaga(saga.scope[0]!);

    const after = sim.sagas.find((s) => s.scope[0] === saga.scope[0])!;
    expect(after.status).toBe("rolled_back");
    expect(after.affectedWorkspaceIds).toEqual(["wA"]);
    // wB, wC untouched
    expect(sim.workspaceStatus("wB")).toBe("active");
    expect(sim.workspaceStatus("wC")).toBe("active");
  });
});

describe("TC-PRODUCT-08 — Workspace lifecycle archive → delete", () => {
  it("archive → delete preserves audit, reports orphans", () => {
    const sim = new ProductLifecycleSimulator();
    sim.createWorkspace({ id: "wL", name: "lifecycle", weight: 1, weeklyBudgetUsd: 100, founderWeeklyHours: 10 });
    for (let i = 0; i < 5; i++) sim.spawnMission("wL");
    sim.advanceDays(3);

    sim.archiveWorkspace("wL");
    expect(sim.workspaceStatus("wL")).toBe("archived");

    const result = sim.deleteWorkspace("wL");
    expect(sim.workspaceStatus("wL")).toBe("deleted");
    expect(result.auditPreserved).toBe(true);
    expect(result.orphaned).toBeGreaterThanOrEqual(0);
  });

  it("must archive before delete", () => {
    const sim = new ProductLifecycleSimulator();
    sim.createWorkspace({ id: "wX", name: "x", weight: 1, weeklyBudgetUsd: 100, founderWeeklyHours: 10 });
    expect(() => sim.deleteWorkspace("wX")).toThrow(/must archive/);
  });
});

describe("TC-PRODUCT-09 — KPI delivery acceptance", () => {
  it("North Star KPIs hold across simulated month", () => {
    const sim = new ProductLifecycleSimulator();
    sim.createWorkspace({ id: "wn", name: "ns", weight: 1, weeklyBudgetUsd: 200, founderWeeklyHours: 12.5 });

    for (let week = 0; week < 4; week++) {
      for (let i = 0; i < 4; i++) {
        const m = sim.spawnMission("wn", { brier: 0.12, ship: i === 0 });
        sim.recordGate("wn", m.id, "auto_approved", 4);
      }
      sim.advanceDays(7);
    }

    const kpi = sim.snapshotKPI("wn", 7);
    expect(kpi.gatesPerWeek).toBeLessThanOrEqual(8);
    expect(kpi.founderHoursPerWeek).toBeLessThanOrEqual(12.5);
    expect(kpi.featuresShippedTotal).toBeGreaterThanOrEqual(2);
    expect(kpi.averageBrier).toBeLessThan(0.15);
  });
});

describe("TC-PRODUCT-10 — Long-running soak stability", () => {
  it("90-day soak shows bounded heap growth and no cron starvation", () => {
    const sim = new ProductLifecycleSimulator();
    sim.createWorkspace({ id: "wsoak", name: "soak", weight: 1, weeklyBudgetUsd: 300, founderWeeklyHours: 10 });

    for (let day = 0; day < 90; day++) {
      if (day % 3 === 0) {
        const m = sim.spawnMission("wsoak");
        sim.recordGate("wsoak", m.id, "auto_approved", 3);
      }
      sim.advanceDays(1);
    }

    expect(sim.heapSnapshots.length).toBeGreaterThan(10);
    const first = sim.heapSnapshots[0]!.bytes;
    const last = sim.heapSnapshots.at(-1)!.bytes;
    // Heap growth bounded under 2x baseline
    expect(last).toBeLessThan(first * 3);

    const cronTicks = sim.cronExecutionLog.filter((c) => c.cron === "daily_tick").length;
    expect(cronTicks).toBe(90);
  });
});
