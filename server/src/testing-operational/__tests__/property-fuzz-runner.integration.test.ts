// Integration tests for PropertyFuzzRunner.
// Gate criteria:
//   • Good property (n + 1 > n) over 100 runs → 0 failures.
//   • Buggy property (n < 100) over 100 runs of integers → ≥ 1 failure with
//     shrunk value equal to smallest failing n found (≤ original failing n).

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { PropertyFuzzRunner } from "../property-fuzz-runner.js";
import { TestRunStore } from "../../testing-foundation/test-run-store.js";
import type { Generator } from "../property-fuzz-runner.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping PropertyFuzzRunner integration: ${support.reason ?? "unsupported"}`);
}

desc("PropertyFuzzRunner integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let runner!: PropertyFuzzRunner;
  let runStore!: TestRunStore;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("fuzz-runner-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    runner = new PropertyFuzzRunner(db);
    runStore = new TestRunStore(db);
  });

  afterEach(async () => {
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
      name: `FuzzCo-${prefix}`,
      issuePrefix: `FZ${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  // Integer generator: produces integers in [-200, 200]
  const intGen: Generator<number> = (rng) => rng.nextInt(-200, 200);

  it("good property (n + 1 > n) over 100 runs → 0 failures", async () => {
    const companyId = await seedCompany("good");
    const run = await runStore.create({ companyId, dimension: "fuzz", prRef: `pr-fz-${randomUUID().slice(0, 8)}` });

    const result = await runner.runProperty({
      testRunId: run.id,
      target: "increment-greater",
      propertyFn: (n: unknown) => (n as number) + 1 > (n as number),
      generators: [intGen],
      totalRuns: 100,
      seed: "good-prop-seed",
    });

    expect(result.failures).toBe(0);
    expect(result.shrunkFailures).toBe(0);
    expect(result.totalRuns).toBe(100);
    expect(result.testRunId).toBe(run.id);
  });

  it("buggy property (n < 100) → ≥1 failure, shrunk value ≤ original", async () => {
    const companyId = await seedCompany("buggy");
    const run = await runStore.create({ companyId, dimension: "fuzz", prRef: `pr-fz-${randomUUID().slice(0, 8)}` });

    // Use a generator that reliably produces values > 100
    const largeIntGen: Generator<number> = (rng) => rng.nextInt(101, 200);

    const result = await runner.runProperty({
      testRunId: run.id,
      target: "n-lt-100",
      propertyFn: (n: unknown) => (n as number) < 100,
      generators: [largeIntGen],
      totalRuns: 100,
      seed: "buggy-prop-seed",
    });

    expect(result.failures).toBeGreaterThan(0);

    // Verify the summary contains failure samples with shrunk inputs
    const samples = result.summary["failureSamples"] as Array<{
      inputs: number[];
      shrunkInputs: number[];
    }>;
    expect(samples.length).toBeGreaterThan(0);

    // Shrunk value should be ≤ original failing value (closer to 0)
    for (const sample of samples) {
      const original = sample.inputs[0];
      const shrunk = sample.shrunkInputs[0];
      // shrunk should be a smaller positive number (closer to zero)
      expect(Math.abs(shrunk)).toBeLessThanOrEqual(Math.abs(original));
    }
  });

  it("listByTestRun returns all fuzz summaries for the run", async () => {
    const companyId = await seedCompany("list");
    const run = await runStore.create({ companyId, dimension: "fuzz", prRef: `pr-fz-${randomUUID().slice(0, 8)}` });

    await runner.runProperty({
      testRunId: run.id,
      target: "target-a",
      propertyFn: () => true,
      generators: [intGen],
      totalRuns: 10,
    });
    await runner.runProperty({
      testRunId: run.id,
      target: "target-b",
      propertyFn: () => true,
      generators: [intGen],
      totalRuns: 10,
    });

    const list = await runner.listByTestRun(run.id);
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.target).sort()).toEqual(["target-a", "target-b"]);
  });
});
