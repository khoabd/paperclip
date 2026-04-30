// Integration tests for FullSystemGateChecker.
// Gate criteria:
//   • With synthetic green data, criteria that can pass with DB data return met=true.
//   • Criterion 12 (mobile) always returns met=false (explicitly deferred).
//   • run() always returns { allMet, results } with 15 entries.
//   • renderMarkdown() returns a non-empty string with table rows.
//   • With red data injected for one criterion, that criterion returns met=false.
//
// Note: "queryable shape" contract — checks verify function returns correct type,
// not that all 15 business criteria are met in the test environment.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { FullSystemGateChecker } from "../full-system-gate-checker.js";
import { HealthMetricsCollector } from "../health-metrics-collector.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping FullSystemGateChecker integration: ${support.reason ?? "unsupported"}`);
}

desc("FullSystemGateChecker integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("gate-checker-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
  });

  afterEach(async () => {
    // Clean up in FK-safe order (children before parents)
    await db.execute(sql`DELETE FROM system_health_metrics`);
    await db.execute(sql`DELETE FROM explain_audit_records`);
    await db.execute(sql`DELETE FROM fuzz_run_summaries`);
    await db.execute(sql`DELETE FROM test_runs`);
    await db.execute(sql`DELETE FROM brier_calibration`);
    await db.execute(sql`DELETE FROM rejection_clusters`);
    await db.execute(sql`DELETE FROM sagas`);
    await db.execute(sql`DELETE FROM greenfield_intakes`);
    await db.execute(sql`DELETE FROM human_drag_in_events`);
    await db.execute(sql`DELETE FROM stuck_events`);
    await db.execute(sql`DELETE FROM workflow_health`);
    await db.execute(sql`DELETE FROM approvals`);
    await db.execute(sql`DELETE FROM missions`);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedCompany(prefix: string): Promise<string> {
    const id = randomUUID();
    // Use first 6 hex chars of uuid for guaranteed uniqueness across test runs
    const unique = id.replace(/-/g, "").slice(0, 6).toUpperCase();
    await db.insert(companies).values({
      id,
      name: `GCCo-${prefix}`,
      issuePrefix: `G${unique}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("run() always returns 15 criterion results", async () => {
    const companyId = await seedCompany("shape");
    const checker = new FullSystemGateChecker(db, companyId);
    const report = await checker.run();

    expect(report.results).toHaveLength(15);
    expect(report.checkedAt).toBeInstanceOf(Date);
    expect(typeof report.allMet).toBe("boolean");

    // Every result has the correct shape
    for (const r of report.results) {
      expect(typeof r.id).toBe("number");
      expect(typeof r.label).toBe("string");
      expect(typeof r.met).toBe("boolean");
      expect(typeof r.evidence).toBe("string");
    }

    // Result ids are 1..15
    const ids = report.results.map((r) => r.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it("criterion 12 (mobile) is always met=false (explicitly deferred to v1.1)", async () => {
    const companyId = await seedCompany("mobile");
    const checker = new FullSystemGateChecker(db, companyId);
    const report = await checker.run();

    const c12 = report.results.find((r) => r.id === 12);
    expect(c12).toBeDefined();
    expect(c12!.met).toBe(false);
    expect(c12!.evidence).toContain("DEFERRED");
  });

  it("criterion 8 (Brier) returns met=false when no calibration data exists", async () => {
    const companyId = await seedCompany("brier-empty");
    const checker = new FullSystemGateChecker(db, companyId);
    const c8 = await checker.check8_brierCalibration();

    expect(c8.id).toBe(8);
    expect(c8.met).toBe(false);
    expect(c8.evidence).toContain("no brier calibration data");
  });

  it("criterion 8 (Brier) returns met=true when avg brier < 0.15", async () => {
    const companyId = await seedCompany("brier-good");
    // Seed brier_calibration rows with score < 0.15
    await db.execute(sql`
      INSERT INTO brier_calibration (id, scope, scope_id, window_days, n, brier_score)
      VALUES
        (gen_random_uuid(), 'workspace', ${companyId}, 7, 50, 0.08),
        (gen_random_uuid(), 'workspace', ${companyId}, 7, 50, 0.10)
    `);

    const checker = new FullSystemGateChecker(db, companyId);
    const c8 = await checker.check8_brierCalibration();
    expect(c8.met).toBe(true);
    expect(c8.evidence).toContain("0.09");
  });

  it("criterion 2 (gate compliance) returns met=false when no health metrics recorded", async () => {
    const companyId = await seedCompany("gate-empty");
    // Need at least one approval to avoid short-circuit
    await db.execute(sql`
      INSERT INTO approvals (id, company_id, type, status, payload, created_at, updated_at)
      VALUES (gen_random_uuid(), ${companyId}, 'code_change', 'pending', '{}', now(), now())
    `);

    const checker = new FullSystemGateChecker(db, companyId);
    const c2 = await checker.check2_gatePatternCompliance();
    expect(c2.id).toBe(2);
    expect(c2.met).toBe(false);
  });

  it("criterion 2 (gate compliance) returns met=true when health metric status=green", async () => {
    const companyId = await seedCompany("gate-green");
    const collector = new HealthMetricsCollector(db);
    // Also insert an approval so total > 0 to bypass the short-circuit
    await db.execute(sql`
      INSERT INTO approvals (id, company_id, type, status, payload, created_at, updated_at)
      VALUES (gen_random_uuid(), ${companyId}, 'code_change', 'pending', '{}', now(), now())
    `);
    // Record a green gate_compliance metric
    await collector.record({
      companyId,
      scope: "workspace",
      kind: "gate_compliance",
      value: 0.90,
      threshold: 0.8,
    });

    const checker = new FullSystemGateChecker(db, companyId);
    const c2 = await checker.check2_gatePatternCompliance();
    expect(c2.met).toBe(true);
  });

  it("criterion 3 (trust promotion) returns met=false when no metrics", async () => {
    const companyId = await seedCompany("trust-empty");
    const checker = new FullSystemGateChecker(db, companyId);
    const c3 = await checker.check3_trustPromotion();
    expect(c3.met).toBe(false);
    expect(c3.evidence).toContain("no trust_promotion_rate metrics");
  });

  it("criterion 3 (trust promotion) returns met=true when metric status=green", async () => {
    const companyId = await seedCompany("trust-green");
    const collector = new HealthMetricsCollector(db);
    await collector.record({
      companyId,
      scope: "workspace",
      kind: "trust_promotion_rate",
      value: 0.9,
      threshold: 0.7,
    });

    const checker = new FullSystemGateChecker(db, companyId);
    const c3 = await checker.check3_trustPromotion();
    expect(c3.met).toBe(true);
  });

  it("criterion 4 (drag-in rate) returns met=true when 0 drag-in events this week", async () => {
    const companyId = await seedCompany("dragin-zero");
    const checker = new FullSystemGateChecker(db, companyId);
    const c4 = await checker.check4_dragInRate();
    expect(c4.met).toBe(true);
    expect(c4.evidence).toContain("0 drag-in events");
  });

  it("allMet=false when criterion 12 is always false (mobile deferred)", async () => {
    const companyId = await seedCompany("allmet");
    const checker = new FullSystemGateChecker(db, companyId);
    const report = await checker.run();
    // Since criterion 12 is always false, allMet must be false
    expect(report.allMet).toBe(false);
  });

  it("renderMarkdown() produces a table with 15 rows", () => {
    const fakeReport = {
      allMet: false,
      checkedAt: new Date("2026-04-29T00:00:00Z"),
      results: Array.from({ length: 15 }, (_, i) => ({
        id: i + 1,
        label: `Criterion ${i + 1}`,
        met: i !== 11, // criterion 12 (0-indexed 11) is false
        evidence: `evidence-${i + 1}`,
      })),
    };

    const md = FullSystemGateChecker.renderMarkdown(fakeReport);
    expect(md).toContain("Full-System Gate Report");
    // Should have 15 table rows (each starts with "| " and has a number)
    const tableRows = md.split("\n").filter((l) => /^\| \d+/.test(l));
    expect(tableRows).toHaveLength(15);
    expect(md).toContain("14/15 criteria met");
    expect(md).toContain("Failing Criteria");
  });
});
