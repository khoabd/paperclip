// TC-CHAOS-07 — Level=global emergency stop with notification dispatcher + orphan
// tracker. Builds on the existing KillSwitch primitive and adds the escalation +
// in-flight side effect tracking that the scenario calls out.

import { describe, expect, it } from "vitest";
import {
  EscalationDispatcher,
  InMemoryChannel,
  FailingChannel,
  type EscalationEvent,
} from "../escalation-dispatcher.js";
import { OrphanTracker } from "../orphan-tracker.js";

describe("TC-CHAOS-07 — emergency stop escalation + orphan tracking", () => {
  it("dispatcher fans out the page event to every healthy channel", async () => {
    const pagerDuty = new InMemoryChannel("pagerduty");
    const email = new InMemoryChannel("email");
    const slack = new InMemoryChannel("slack");
    const dispatcher = new EscalationDispatcher([pagerDuty, email, slack]);

    const event: EscalationEvent = {
      id: "kill_evt_1",
      severity: "page",
      title: "Emergency stop level=global",
      body: "10 missions killed, manual recovery required",
      meta: { killEventId: "k_1", killedCount: 10, level: "global" },
      occurredAt: new Date(),
    };

    const stats = await dispatcher.fire(event);
    expect(stats.delivered).toBe(3);
    expect(stats.failed).toBe(0);
    expect(pagerDuty.delivered[0]?.severity).toBe("page");
    expect(email.delivered[0]?.title).toContain("Emergency stop");
    expect(slack.delivered).toHaveLength(1);
  });

  it("dispatcher continues when a channel fails — partial delivery still counts", async () => {
    const pagerDuty = new FailingChannel("pagerduty");
    const email = new InMemoryChannel("email");
    const dispatcher = new EscalationDispatcher([pagerDuty, email]);

    const stats = await dispatcher.fire({
      id: "kill_evt_2",
      severity: "page",
      title: "Emergency stop",
      body: "...",
      meta: {},
      occurredAt: new Date(),
    });

    expect(stats.delivered).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.perChannel.email!.delivered).toBe(1);
    expect(stats.perChannel.pagerduty!.failed).toBe(1);
    expect(email.delivered).toHaveLength(1);
  });

  it("orphan tracker reports in-flight side effects when emergency-stop sweeps", () => {
    const tracker = new OrphanTracker();

    const t1 = tracker.register({ kind: "db_write", description: "missions update" });
    const t2 = tracker.register({ kind: "external_api", description: "GitLab MR open" });
    const t3 = tracker.register({ kind: "queue_publish", description: "audit topic" });

    // t1 completes before kill; t2 + t3 still in-flight.
    tracker.complete(t1);

    const report = tracker.sweep();
    expect(report.totalRegistered).toBe(3);
    expect(report.totalCompleted).toBe(1);
    expect(report.orphans).toHaveLength(2);
    expect(report.orphans.map((o) => o.kind).sort()).toEqual(["external_api", "queue_publish"]);
  });

  it("end-to-end: 50 in-flight side effects with 90% completing before kill — 10% orphans flagged", () => {
    const tracker = new OrphanTracker();
    const tokens: string[] = [];
    for (let i = 0; i < 50; i++) {
      tokens.push(tracker.register({ kind: "db_write", description: `op ${i}` }));
    }
    // 45 of 50 finish in time.
    for (let i = 0; i < 45; i++) tracker.complete(tokens[i]!);
    const report = tracker.sweep();
    expect(report.orphans.length).toBe(5);
    expect(report.totalCompleted).toBe(45);
  });
});
