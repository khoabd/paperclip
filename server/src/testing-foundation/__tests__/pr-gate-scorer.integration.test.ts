// Integration tests for PRGateScorer.
// Gate criteria:
//   3 test_runs (visual=80, a11y=50 with critical violation, cross_browser=85)
//   → blocked=true, weakDimensions includes 'a11y'.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { PRGateScorer } from "../pr-gate-scorer.js";
import { TestRunStore } from "../test-run-store.js";
import { A11yViolationCollector } from "../a11y-violation-collector.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping PRGateScorer integration: ${support.reason ?? "unsupported"}`);
}

desc("PRGateScorer integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let scorer!: PRGateScorer;
  let runStore!: TestRunStore;
  let collector!: A11yViolationCollector;
  let companyId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("pr-gate-scorer-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    scorer = new PRGateScorer(db);
    runStore = new TestRunStore(db);
    collector = new A11yViolationCollector(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM cross_browser_results`);
    await db.execute(sql`DELETE FROM a11y_violations`);
    await db.execute(sql`DELETE FROM visual_baselines`);
    await db.execute(sql`DELETE FROM test_runs`);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedCompany(prefix: string): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name: `GateCo-${prefix}`,
      issuePrefix: `GS${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("visual=80, a11y=50 with critical, cross_browser=85 → blocked=true, a11y in weakDimensions", async () => {
    companyId = await seedCompany("main");
    const PR = `pr-gate-${randomUUID().slice(0, 8)}`;

    // visual run: score=80 (passes threshold)
    const visualRun = await runStore.create({ companyId, dimension: "visual", prRef: PR });
    await runStore.markPassed(visualRun.id, 80, { note: "visual ok" });

    // a11y run: score=50 (below 60 — weak) + critical violation
    const a11yRun = await runStore.create({ companyId, dimension: "a11y", prRef: PR });
    await runStore.markFailed(a11yRun.id, 50, { note: "a11y issues" });
    await collector.record(a11yRun.id, [
      { ruleId: "color-contrast", impact: "critical", targetSelector: "button.submit" },
      { ruleId: "label", impact: "minor", targetSelector: "input#email" },
    ]);

    // cross_browser run: score=85 (passes threshold)
    const cbRun = await runStore.create({ companyId, dimension: "cross_browser", prRef: PR });
    await runStore.markPassed(cbRun.id, 85, { note: "cross browser ok" });

    const result = await scorer.scoreForPR(PR);

    expect(result.blocked).toBe(true);
    expect(result.weakDimensions).toContain("a11y");
    // score = (80 + 50 + 85) / 3 ≈ 71.67
    expect(result.score).toBeCloseTo(71.67, 1);
  });

  it("all dimensions pass with no critical violations → not blocked", async () => {
    companyId = await seedCompany("pass");
    const PR = `pr-pass-${randomUUID().slice(0, 8)}`;

    const visualRun = await runStore.create({ companyId, dimension: "visual", prRef: PR });
    await runStore.markPassed(visualRun.id, 92);

    const a11yRun = await runStore.create({ companyId, dimension: "a11y", prRef: PR });
    await runStore.markPassed(a11yRun.id, 88);
    // Only minor violations — no block
    await collector.record(a11yRun.id, [
      { ruleId: "color-contrast", impact: "minor", targetSelector: "p.footer" },
    ]);

    const cbRun = await runStore.create({ companyId, dimension: "cross_browser", prRef: PR });
    await runStore.markPassed(cbRun.id, 95);

    const result = await scorer.scoreForPR(PR);

    expect(result.blocked).toBe(false);
    expect(result.weakDimensions).toHaveLength(0);
  });

  it("a11y run with critical violation blocks even if score >= 60", async () => {
    companyId = await seedCompany("crit");
    const PR = `pr-crit-${randomUUID().slice(0, 8)}`;

    const a11yRun = await runStore.create({ companyId, dimension: "a11y", prRef: PR });
    await runStore.markPassed(a11yRun.id, 75); // score above 60
    // But has a critical violation
    await collector.record(a11yRun.id, [
      { ruleId: "aria-required-attr", impact: "critical", targetSelector: "[role='dialog']" },
    ]);

    const result = await scorer.scoreForPR(PR);

    expect(result.blocked).toBe(true);
    expect(result.weakDimensions).toContain("a11y");
  });

  it("no test runs for PR → not blocked, score=0", async () => {
    companyId = await seedCompany("nop");
    const result = await scorer.scoreForPR(`pr-nonexistent-${randomUUID()}`);
    expect(result.blocked).toBe(false);
    expect(result.score).toBe(0);
    expect(result.weakDimensions).toHaveLength(0);
  });
});
