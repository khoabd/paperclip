// Integration tests for CrossDeviceMatrix.
// Gate criteria:
//   matrix of 4 devices × 1 viewport → 4 results persisted.
//   Force one device to fail (diff > 1000) → status='failed' on that row.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql, eq } from "drizzle-orm";
import { crossDeviceResults } from "@paperclipai/db/schema/cross_device_results";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { CrossDeviceMatrix } from "../cross-device-matrix.js";
import { TestRunStore } from "../../testing-foundation/test-run-store.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping CrossDeviceMatrix integration: ${support.reason ?? "unsupported"}`);
}

desc("CrossDeviceMatrix integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let matrix!: CrossDeviceMatrix;
  let runStore!: TestRunStore;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("cross-device-matrix-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    matrix = new CrossDeviceMatrix(db);
    runStore = new TestRunStore(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM cross_device_results`);
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
      name: `CDCo-${prefix}`,
      issuePrefix: `CD${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("4 devices × 1 viewport → 4 results persisted, all passed when diff ≤ 1000", async () => {
    const companyId = await seedCompany("all");
    const run = await runStore.create({
      companyId,
      dimension: "cross_browser",
      prRef: `pr-cd-${randomUUID().slice(0, 8)}`,
    });

    const devices = [
      { deviceClass: "mobile", viewport: "375x667", browser: "chrome" },
      { deviceClass: "tablet", viewport: "768x1024", browser: "safari" },
      { deviceClass: "desktop", viewport: "1280x800", browser: "chrome" },
      { deviceClass: "wide_desktop", viewport: "1920x1080", browser: "chrome" },
    ];

    // Stub: all return diffPixelCount=500 (below threshold)
    const screenshotter = async ({ deviceClass, viewport }: { deviceClass: string; viewport: string; browser: string; route: string }) => ({
      uri: `s3://cross-device/${deviceClass}-${viewport}.png`,
      diffPixelCount: 500,
    });

    const results = await matrix.runMatrix(run.id, {
      route: "/dashboard",
      devices,
      screenshotter,
    });

    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.status).toBe("passed");
      expect(r.diffPixelCount).toBe(500);
    }

    // Verify 4 rows persisted to DB
    const rows = await db
      .select()
      .from(crossDeviceResults)
      .where(eq(crossDeviceResults.testRunId, run.id));
    expect(rows).toHaveLength(4);
  });

  it("one device with diff > 1000 → status='failed' on that row only", async () => {
    const companyId = await seedCompany("fail");
    const run = await runStore.create({
      companyId,
      dimension: "cross_browser",
      prRef: `pr-cd-${randomUUID().slice(0, 8)}`,
    });

    const devices = [
      { deviceClass: "mobile", viewport: "375x667", browser: "chrome" },
      { deviceClass: "tablet", viewport: "768x1024", browser: "safari" },
      { deviceClass: "desktop", viewport: "1280x800", browser: "chrome" },
      { deviceClass: "wide_desktop", viewport: "1920x1080", browser: "chrome" },
    ];

    // Stub: wide_desktop device returns diffPixelCount=1500 (above threshold)
    const screenshotter = async ({ deviceClass, viewport }: { deviceClass: string; viewport: string; browser: string; route: string }) => {
      if (deviceClass === "wide_desktop") {
        return { uri: `s3://cross-device/${deviceClass}-${viewport}.png`, diffPixelCount: 1500 };
      }
      return { uri: `s3://cross-device/${deviceClass}-${viewport}.png`, diffPixelCount: 200 };
    };

    const results = await matrix.runMatrix(run.id, {
      route: "/settings",
      devices,
      screenshotter,
    });

    expect(results).toHaveLength(4);

    const failed = results.filter((r) => r.status === "failed");
    const passed = results.filter((r) => r.status === "passed");

    expect(failed).toHaveLength(1);
    expect(failed[0].deviceClass).toBe("wide_desktop");
    expect(failed[0].diffPixelCount).toBe(1500);
    expect(passed).toHaveLength(3);

    // Verify DB rows
    const rows = await db
      .select()
      .from(crossDeviceResults)
      .where(eq(crossDeviceResults.testRunId, run.id));
    expect(rows).toHaveLength(4);
    const failedRow = rows.find((r) => r.status === "failed");
    expect(failedRow).toBeDefined();
    expect(failedRow!.deviceClass).toBe("wide_desktop");
    expect(failedRow!.diffPixelCount).toBe(1500);
  });
});
