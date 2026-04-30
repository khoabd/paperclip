// Integration tests for CrossBrowserRunner.
// Gate criteria:
//   matrix of (chrome, firefox, webkit) × (desktop, mobile) → 6 results persisted;
//   force one to fail diff > 1000 → status=failed.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql, eq } from "drizzle-orm";
import { crossBrowserResults } from "@paperclipai/db/schema/cross_browser_results";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { CrossBrowserRunner } from "../cross-browser-runner.js";
import { TestRunStore } from "../test-run-store.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping CrossBrowserRunner integration: ${support.reason ?? "unsupported"}`);
}

desc("CrossBrowserRunner integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let runStore!: TestRunStore;
  let companyId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("cross-browser-runner-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    runStore = new TestRunStore(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM cross_browser_results`);
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
      name: `CBCo-${prefix}`,
      issuePrefix: `CB${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("matrix 3 browsers × 2 viewports → 6 results, all new_baseline_needed on first run", async () => {
    companyId = await seedCompany("mat");

    const run = await runStore.create({
      companyId,
      dimension: "cross_browser",
      prRef: "pr-cb-matrix",
    });

    // Deterministic stub: just return a URI, no real Playwright
    const screenshotter = async ({ browser, viewport, route }: { browser: string; viewport: string; route: string }) => ({
      uri: `s3://screenshots/${browser}-${viewport}-${route.replace("/", "")}.png`,
      sha: `sha256:${browser}-${viewport}`,
    });

    // No baselines exist yet, so differ should not be called
    const differ = async () => ({ diffPixelCount: 0 });

    const runner = new CrossBrowserRunner(db, screenshotter, differ);

    const results = await runner.runMatrix(run.id, {
      companyId,
      route: "/app",
      browsers: ["chrome", "firefox", "webkit"],
      viewports: ["1440x900", "375x667"],
    });

    expect(results).toHaveLength(6);
    for (const r of results) {
      expect(r.status).toBe("new_baseline_needed");
    }

    // Verify 6 rows persisted
    const rows = await db
      .select()
      .from(crossBrowserResults)
      .where(eq(crossBrowserResults.testRunId, run.id));
    expect(rows).toHaveLength(6);
  });

  it("second run uses baselines; diff > 1000 for one cell → status=failed", async () => {
    companyId = await seedCompany("diff");

    // Run 1: establish baselines
    const run1 = await runStore.create({
      companyId,
      dimension: "cross_browser",
      prRef: "pr-cb-diff-r1",
    });

    const screenshotter = async ({ browser, viewport }: { browser: string; viewport: string }) => ({
      uri: `s3://screenshots/${browser}-${viewport}.png`,
      sha: `sha256:${browser}-${viewport}-v1`,
    });

    const noopDiffer = async () => ({ diffPixelCount: 0 });
    const runner1 = new CrossBrowserRunner(db, screenshotter, noopDiffer);

    await runner1.runMatrix(run1.id, {
      companyId,
      route: "/checkout",
      browsers: ["chrome", "firefox", "webkit"],
      viewports: ["1440x900", "375x667"],
    });

    // Run 2: baselines now exist; inject a differ that returns > 1000 for chrome/desktop only
    const run2 = await runStore.create({
      companyId,
      dimension: "cross_browser",
      prRef: "pr-cb-diff-r2",
    });

    let callIndex = 0;
    const heavyDiffer = async ({ currentUri }: { currentUri: string; baselineUri: string }) => {
      callIndex++;
      // Force chrome-1440x900 (first call) to exceed threshold
      if (callIndex === 1) return { diffPixelCount: 1500 };
      return { diffPixelCount: 10 };
    };

    const runner2 = new CrossBrowserRunner(db, screenshotter, heavyDiffer);

    const results = await runner2.runMatrix(run2.id, {
      companyId,
      route: "/checkout",
      browsers: ["chrome", "firefox", "webkit"],
      viewports: ["1440x900", "375x667"],
    });

    expect(results).toHaveLength(6);

    const failed = results.filter((r) => r.status === "failed");
    const passed = results.filter((r) => r.status === "passed");

    expect(failed).toHaveLength(1);
    expect(failed[0].browser).toBe("chrome");
    expect(failed[0].viewport).toBe("1440x900");
    expect(failed[0].diffPixelCount).toBe(1500);
    expect(passed).toHaveLength(5);

    // Verify all 6 rows persisted for run2
    const rows = await db
      .select()
      .from(crossBrowserResults)
      .where(eq(crossBrowserResults.testRunId, run2.id));
    expect(rows).toHaveLength(6);
    const failedRow = rows.find((r) => r.status === "failed");
    expect(failedRow).toBeDefined();
    expect(failedRow!.diffPixelCount).toBe(1500);
  });
});
