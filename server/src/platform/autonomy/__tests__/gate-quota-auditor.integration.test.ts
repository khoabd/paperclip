// TC-CP-10: Gate quota breach triggers auditor review.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { approvals, companies, createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../../__tests__/helpers/embedded-postgres.js";
import { GateQuotaAuditor } from "../gate-quota-auditor.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping GateQuotaAuditor integration: ${support.reason ?? "unsupported"}`);
}

desc("GateQuotaAuditor — TC-CP-10", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let companyId!: string;
  const NOW = new Date("2026-04-29T12:00:00.000Z");

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("gate-quota-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);

    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Gate Quota Co",
      status: "active",
      autonomyLevel: "supervised",
      issuePrefix: `GQA-${companyId.slice(0, 6)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterEach(async () => {
    await db.delete(approvals);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function injectGates(count: number, hoursAgoStart = 1): Promise<void> {
    const rows = [];
    for (let i = 0; i < count; i++) {
      const createdAt = new Date(NOW.getTime() - (hoursAgoStart + i) * 3_600_000);
      rows.push({
        id: randomUUID(),
        companyId,
        type: "code_change",
        payload: { action: { kind: "deploy", summary: `gate-${i}` } },
        status: "pending",
        priority: "medium",
        createdAt,
        updatedAt: createdAt,
      });
    }
    if (rows.length > 0) await db.insert(approvals).values(rows);
  }

  it("9 gates in 7d (default quota 8) → breached, review_gate_triggers", async () => {
    await injectGates(9);
    const auditor = new GateQuotaAuditor(db, () => NOW);
    const report = await auditor.audit({ companyId });

    expect(report.breached).toBe(true);
    expect(report.gatesRaised).toBe(9);
    expect(report.quota).toBe(8);
    expect(report.recommendation.kind).toBe("review_gate_triggers");
  });

  it("8 gates (boundary) → not breached, no_action", async () => {
    await injectGates(8);
    const auditor = new GateQuotaAuditor(db, () => NOW);
    const report = await auditor.audit({ companyId });
    expect(report.breached).toBe(false);
    expect(report.gatesRaised).toBe(8);
    expect(report.recommendation.kind).toBe("no_action");
  });

  it("massive overshoot (16 gates) → recommend increase_autonomy", async () => {
    await injectGates(16);
    const auditor = new GateQuotaAuditor(db, () => NOW);
    const report = await auditor.audit({ companyId });
    expect(report.breached).toBe(true);
    expect(report.recommendation.kind).toBe("increase_autonomy");
    if (report.recommendation.kind === "increase_autonomy") {
      expect(report.recommendation.severity).toBe("MEDIUM");
    }
  });

  it("0 gates in 7d → underutilised warning", async () => {
    const auditor = new GateQuotaAuditor(db, () => NOW);
    const report = await auditor.audit({ companyId });
    expect(report.gatesRaised).toBe(0);
    expect(report.breached).toBe(false);
    expect(report.recommendation.kind).toBe("underutilised");
  });

  it("gates older than 7d are NOT counted (rolling window)", async () => {
    // Inject a row dated 10 days ago — must be excluded.
    const tenDaysAgo = new Date(NOW.getTime() - 10 * 24 * 3_600_000);
    await db.insert(approvals).values({
      id: randomUUID(),
      companyId,
      type: "code_change",
      payload: { action: { kind: "deploy", summary: "stale" } },
      status: "rejected",
      priority: "medium",
      createdAt: tenDaysAgo,
      updatedAt: tenDaysAgo,
    });

    // Plus 3 fresh gates in window.
    await injectGates(3);

    const auditor = new GateQuotaAuditor(db, () => NOW);
    const report = await auditor.audit({ companyId });
    expect(report.gatesRaised).toBe(3); // only fresh ones
  });

  it("custom quota override works", async () => {
    await injectGates(5);
    const auditor = new GateQuotaAuditor(db, () => NOW);
    const report = await auditor.audit({ companyId, quotaPerWeek: 4 });
    expect(report.quota).toBe(4);
    expect(report.breached).toBe(true);
  });

  it("multi-tenant isolation — other workspace's gates not counted", async () => {
    const otherCompany = randomUUID();
    await db.insert(companies).values({
      id: otherCompany,
      name: "Other Co",
      status: "active",
      autonomyLevel: "supervised",
      issuePrefix: `OTH-${otherCompany.slice(0, 6)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // Inject 20 gates against OTHER company.
    const rows = [];
    for (let i = 0; i < 20; i++) {
      const createdAt = new Date(NOW.getTime() - (1 + i) * 3_600_000);
      rows.push({
        id: randomUUID(),
        companyId: otherCompany,
        type: "code_change",
        payload: { action: { kind: "deploy", summary: `other-${i}` } },
        status: "pending",
        priority: "medium",
        createdAt,
        updatedAt: createdAt,
      });
    }
    await db.insert(approvals).values(rows);

    // Inject 1 gate for our company.
    await injectGates(1);

    const auditor = new GateQuotaAuditor(db, () => NOW);
    const report = await auditor.audit({ companyId });
    expect(report.gatesRaised).toBe(1);
    expect(report.breached).toBe(false);
  });
});
