// Integration tests for OperationalPRGateScorer.
// Gate criteria:
//   • Fuzz failures > 3% → blocked, fuzz in weakDimensions.
//   • Fuzz failures ≤ 3% → not blocked from fuzz.
//   • Persona scenario linked to a failed test_run → blocked, persona in weakDimensions.
//   • Manual TC failed → blocked, manual_tc in weakDimensions.
//   • Live synthetic failure in last 30 min → blocked, synthetic in weakDimensions.
//   • All clean → not blocked, score=100.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { OperationalPRGateScorer } from "../operational-pr-gate-scorer.js";
import { PropertyFuzzRunner } from "../property-fuzz-runner.js";
import { PersonaScenarioStore } from "../persona-scenario-store.js";
import { ManualTestCaseStore } from "../manual-test-case-store.js";
import { SyntheticProbeRunner } from "../synthetic-probe-runner.js";
import { TestRunStore } from "../../testing-foundation/test-run-store.js";
import type { Generator } from "../property-fuzz-runner.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping OperationalPRGateScorer integration: ${support.reason ?? "unsupported"}`);
}

desc("OperationalPRGateScorer integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let scorer!: OperationalPRGateScorer;
  let fuzzRunner!: PropertyFuzzRunner;
  let personaStore!: PersonaScenarioStore;
  let manualStore!: ManualTestCaseStore;
  let probeRunner!: SyntheticProbeRunner;
  let runStore!: TestRunStore;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("op-gate-scorer-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    scorer = new OperationalPRGateScorer(db);
    fuzzRunner = new PropertyFuzzRunner(db);
    personaStore = new PersonaScenarioStore(db);
    manualStore = new ManualTestCaseStore(db);
    probeRunner = new SyntheticProbeRunner(db);
    runStore = new TestRunStore(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM synthetic_probe_results`);
    await db.execute(sql`DELETE FROM manual_test_cases`);
    await db.execute(sql`DELETE FROM persona_scenarios`);
    await db.execute(sql`DELETE FROM fuzz_run_summaries`);
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
      name: `OGCo-${prefix}`,
      issuePrefix: `OG${prefix.toUpperCase().slice(0, 4)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  const bigIntGen: Generator<number> = (rng) => rng.nextInt(101, 200);

  it("fuzz failures > 3% → blocked=true, fuzz in weakDimensions", async () => {
    const companyId = await seedCompany("fuzz");
    const PR = `pr-og-${randomUUID().slice(0, 8)}`;
    const run = await runStore.create({ companyId, dimension: "fuzz", prRef: PR });

    // Property: n < 100 with large ints → ~100% failures
    await fuzzRunner.runProperty({
      testRunId: run.id,
      target: "n-lt-100",
      propertyFn: (n: unknown) => (n as number) < 100,
      generators: [bigIntGen],
      totalRuns: 50,
      seed: "og-fuzz-seed",
    });

    const result = await scorer.scoreForPR(PR, companyId);
    expect(result.blocked).toBe(true);
    expect(result.weakDimensions).toContain("fuzz");
  });

  it("fuzz failures ≤ 3% (good property) → not blocked from fuzz", async () => {
    const companyId = await seedCompany("gfuz");
    const PR = `pr-og-${randomUUID().slice(0, 8)}`;
    const run = await runStore.create({ companyId, dimension: "fuzz", prRef: PR });

    await fuzzRunner.runProperty({
      testRunId: run.id,
      target: "always-true",
      propertyFn: () => true,
      generators: [bigIntGen],
      totalRuns: 100,
    });

    const result = await scorer.scoreForPR(PR, companyId);
    expect(result.blocked).toBe(false);
    expect(result.weakDimensions).not.toContain("fuzz");
  });

  it("persona scenario linked to failed run → blocked, persona in weakDimensions", async () => {
    const companyId = await seedCompany("pers");
    const PR = `pr-og-${randomUUID().slice(0, 8)}`;

    const run = await runStore.create({ companyId, dimension: "persona_e2e", prRef: PR });
    // Mark the run as failed
    await runStore.markFailed(run.id, 0);

    // Register a scenario and link it to this run
    const scenario = await personaStore.register({
      companyId,
      personaSlug: "admin-bulk",
      scenarioText: "Admin bulk approves",
      herculesDsl: { steps: [] },
    });
    // Directly link via runScenario (runner is irrelevant here, we care about the link)
    await personaStore.runScenario(
      scenario.id,
      async () => ({ passed: false }),
      run.id,
    );

    const result = await scorer.scoreForPR(PR, companyId);
    expect(result.blocked).toBe(true);
    expect(result.weakDimensions).toContain("persona");
  });

  it("manual TC failed → blocked, manual_tc in weakDimensions", async () => {
    const companyId = await seedCompany("mtc");
    const PR = `pr-og-${randomUUID().slice(0, 8)}`;
    // Need at least one test_run for the PR so the scorer finds it
    await runStore.create({ companyId, dimension: "manual_tc", prRef: PR });

    const tc = await manualStore.create({
      companyId,
      title: "Check nav bar",
      dimension: "manual_tc",
    });
    await manualStore.assign(tc.id, "tester-1");
    await manualStore.submitResult(tc.id, "failed", "s3://evidence/nav-fail.png");

    const result = await scorer.scoreForPR(PR, companyId);
    expect(result.blocked).toBe(true);
    expect(result.weakDimensions).toContain("manual_tc");
  });

  it("live synthetic failure in last 30 min → blocked, synthetic in weakDimensions", async () => {
    const companyId = await seedCompany("synt");
    const PR = `pr-og-${randomUUID().slice(0, 8)}`;
    await runStore.create({ companyId, dimension: "synthetic", prRef: PR });

    await probeRunner.recordResult({
      companyId,
      probeName: "health-check",
      env: "live",
      status: "failed",
      occurredAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
    });

    const result = await scorer.scoreForPR(PR, companyId);
    expect(result.blocked).toBe(true);
    expect(result.weakDimensions).toContain("synthetic");
  });

  it("all clean inputs → not blocked, score=100", async () => {
    const companyId = await seedCompany("cln");
    const PR = `pr-og-${randomUUID().slice(0, 8)}`;
    const run = await runStore.create({ companyId, dimension: "fuzz", prRef: PR });

    // Fuzz with good property
    await fuzzRunner.runProperty({
      testRunId: run.id,
      target: "always-passes",
      propertyFn: () => true,
      generators: [bigIntGen],
      totalRuns: 50,
    });

    const result = await scorer.scoreForPR(PR, companyId);
    expect(result.blocked).toBe(false);
    expect(result.score).toBe(100);
    expect(result.weakDimensions).toHaveLength(0);
  });
});
