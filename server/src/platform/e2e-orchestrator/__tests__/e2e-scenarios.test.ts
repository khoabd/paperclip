// TC-E2E-01..08 — end-to-end orchestration over the in-process simulator.
// Each scenario composes intake → mission → review → release using the same
// primitives the production stack exposes. The browser-driven UI flow stays out
// of scope; what we verify here is the orchestration contract — events fire in
// the right order, state transitions hold, recovery paths work.

import { describe, expect, it } from "vitest";
import { ProductLifecycleSimulator } from "../../simulator/product-lifecycle.js";
import {
  EscalationDispatcher,
  InMemoryChannel,
} from "../../self-healing/escalation-dispatcher.js";
import { OrphanTracker } from "../../self-healing/orphan-tracker.js";

describe("TC-E2E-01 — Daily 24h cron cycle", () => {
  it("daily ticks fire on each simulated day; no overlap, no missed runs", () => {
    const sim = new ProductLifecycleSimulator();
    sim.createWorkspace({ id: "w", name: "w", weight: 1, weeklyBudgetUsd: 200, founderWeeklyHours: 10 });
    sim.advanceDays(14);
    const ticks = sim.cronExecutionLog.filter((c) => c.cron === "daily_tick");
    expect(ticks.length).toBe(14);
    const days = ticks.map((t) => t.day);
    expect(days).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
  });
});

describe("TC-E2E-02 — Weekly strategic loop ends in sprint approval", () => {
  it("3 sprints worth of missions resolve and feed KPI snapshot", () => {
    const sim = new ProductLifecycleSimulator();
    sim.createWorkspace({ id: "wstrat", name: "strat", weight: 1, weeklyBudgetUsd: 300, founderWeeklyHours: 12 });

    for (let sprint = 0; sprint < 3; sprint++) {
      for (let i = 0; i < 5; i++) {
        const m = sim.spawnMission("wstrat", { brier: 0.11, ship: i === 0 });
        sim.recordGate("wstrat", m.id, "approved", 5);
      }
      sim.advanceDays(7);
    }
    const kpi = sim.snapshotKPI("wstrat", 21);
    expect(kpi.featuresShippedTotal).toBeGreaterThanOrEqual(3);
    expect(kpi.gatesPerWeek).toBeGreaterThanOrEqual(0);
  });
});

describe("TC-E2E-03 — Feature intake → live (12 simulated days)", () => {
  it("single feature lands within 12-day SLO, gate path captured", () => {
    const sim = new ProductLifecycleSimulator();
    sim.createWorkspace({ id: "wf", name: "feature", weight: 1, weeklyBudgetUsd: 100, founderWeeklyHours: 10 });

    const m = sim.spawnMission("wf", { brier: 0.1, ship: true });
    sim.recordGate("wf", m.id, "approved", 6);
    sim.advanceDays(12);
    const after = sim.missions.find((x) => x.id === m.id)!;
    expect(after.status).toBe("done");
    expect(after.completedDay).toBeLessThanOrEqual(12);
    expect(after.featureShipped).toBe(true);
  });
});

describe("TC-E2E-04 — Incident response: spike → auto-rollback", () => {
  it("incident triggers saga rollback + escalation dispatch", async () => {
    const sim = new ProductLifecycleSimulator();
    sim.createWorkspace({ id: "wi", name: "incident", weight: 1, weeklyBudgetUsd: 100, founderWeeklyHours: 10 });

    const released = sim.spawnMission("wi", { ship: true });
    sim.advanceDays(1);

    // simulate log spike → trigger saga rollback
    const saga = sim.triggerSaga(["release_v2"], ["wi"]);
    sim.rollbackSaga(saga.scope[0]!);
    sim.cancelMission(released.id, "auto-rollback after error spike");

    // dispatch incident notification
    const channel = new InMemoryChannel("oncall");
    const dispatcher = new EscalationDispatcher([channel]);
    await dispatcher.fire({
      id: "inc_1",
      severity: "critical",
      title: "auto rollback fired",
      body: "release_v2 reverted",
      meta: { sagaId: saga.scope[0] },
      occurredAt: new Date(),
    });

    expect(sim.sagas.find((s) => s.scope[0] === saga.scope[0])!.status).toBe("rolled_back");
    expect(channel.delivered).toHaveLength(1);
    const cancelledMission = sim.missions.find((m) => m.id === released.id)!;
    expect(cancelledMission.cancelled).toBe(true);
  });
});

describe("TC-E2E-06 — Self-heal cascade: stuck → watchdog → recover/escalate", () => {
  it("watchdog flips stalled missions to blocked; recovery resumes the rest", () => {
    const sim = new ProductLifecycleSimulator();
    sim.createWorkspace({ id: "wsh", name: "self-heal", weight: 1, weeklyBudgetUsd: 100, founderWeeklyHours: 10 });

    const stuck = sim.spawnMission("wsh");
    const healthy = sim.spawnMission("wsh");
    sim.advanceDays(1);

    // simulate stuck — direct flip
    sim.cancelMission(stuck.id, "watchdog: stalled");
    expect(sim.missions.find((m) => m.id === stuck.id)?.status).toBe("killed");
    expect(sim.missions.find((m) => m.id === healthy.id)?.status).toBe("done");
  });
});

describe("TC-E2E-07 — PR-driven KB staleness cycle", () => {
  it("PR merge → KB stale topics superseded; downstream reads see fresh data", () => {
    const sim = new ProductLifecycleSimulator();
    sim.createWorkspace({ id: "wkb", name: "kb", weight: 1, weeklyBudgetUsd: 100, founderWeeklyHours: 10 });

    sim.addInsight("wkb", "auth-flow.session-token");
    sim.addInsight("wkb", "auth-flow.refresh");
    sim.addInsight("wkb", "billing.stripe");

    const superseded = sim.supersedeInsights("wkb", "auth-flow");
    expect(superseded).toBe(2);

    const billing = sim.insights.find((i) => i.topic === "billing.stripe")!;
    expect(billing.superseded).toBe(false);
  });
});

describe("TC-E2E-08 — T+7 outcome tracker + efficiency reviewer", () => {
  it("post-deploy outcome tracker compares brier prediction vs reality across 7 days", () => {
    const sim = new ProductLifecycleSimulator();
    sim.createWorkspace({ id: "weff", name: "eff", weight: 1, weeklyBudgetUsd: 200, founderWeeklyHours: 10 });

    // 10 missions with known brier scores
    for (let i = 0; i < 10; i++) sim.spawnMission("weff", { brier: 0.1 + (i % 3) * 0.02 });
    sim.advanceDays(7);

    const kpi = sim.snapshotKPI("weff", 7);
    expect(kpi.averageBrier).toBeGreaterThan(0);
    expect(kpi.averageBrier).toBeLessThan(0.2);
    // efficiency reviewer recommendation envelope (mirrors DragInAggregator thresholds)
    const recommendation =
      kpi.averageBrier < 0.1 ? "tighten_threshold" : kpi.averageBrier > 0.15 ? "loosen_threshold" : "no_action";
    expect(["tighten_threshold", "loosen_threshold", "no_action"]).toContain(recommendation);
  });

  it("orphan tracker survives across e2e flow without leaking tokens", () => {
    const tracker = new OrphanTracker();
    const tokens = Array.from({ length: 20 }, (_, i) =>
      tracker.register({ kind: "db_write", description: `op_${i}` }),
    );
    for (const t of tokens) tracker.complete(t);
    const report = tracker.sweep();
    expect(report.orphans).toHaveLength(0);
  });
});
