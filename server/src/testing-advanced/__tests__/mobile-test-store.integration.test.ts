// Integration tests for MobileTestStore.
// Gate criteria:
//   record() persists a row; listByTestRun() returns it.
//   Multiple records on the same test run are all returned.
//   Status defaults to 'passed'.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { MobileTestStore } from "../mobile-test-store.js";
import { TestRunStore } from "../../testing-foundation/test-run-store.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping MobileTestStore integration: ${support.reason ?? "unsupported"}`);
}

desc("MobileTestStore integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let store!: MobileTestStore;
  let runStore!: TestRunStore;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("mobile-test-store-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    store = new MobileTestStore(db);
    runStore = new TestRunStore(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM mobile_test_runs`);
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
      name: `MobCo-${prefix}`,
      issuePrefix: `MB${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("record() persists a row; listByTestRun() returns it", async () => {
    const companyId = await seedCompany("rec");
    const run = await runStore.create({ companyId, dimension: "mobile", prRef: "pr-mob-1" });

    const row = await store.record(run.id, {
      platform: "ios",
      deviceModel: "iPhone 15 Pro",
      osVersion: "17.0",
      screenshotUri: "s3://mobile/ios-iphone15pro.png",
      videoUri: "s3://mobile/ios-iphone15pro.mp4",
      appiumSessionId: "appium-session-abc123",
      status: "passed",
    });

    expect(row.id).toBeTruthy();
    expect(row.testRunId).toBe(run.id);
    expect(row.platform).toBe("ios");
    expect(row.deviceModel).toBe("iPhone 15 Pro");
    expect(row.status).toBe("passed");
    expect(row.appiumSessionId).toBe("appium-session-abc123");

    const list = await store.listByTestRun(run.id);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(row.id);
  });

  it("status defaults to 'passed' when not provided", async () => {
    const companyId = await seedCompany("def");
    const run = await runStore.create({ companyId, dimension: "mobile", prRef: "pr-mob-2" });

    const row = await store.record(run.id, {
      platform: "android",
      deviceModel: "Pixel 8",
      osVersion: "14",
    });

    expect(row.status).toBe("passed");
    expect(row.screenshotUri).toBeNull();
    expect(row.videoUri).toBeNull();
    expect(row.appiumSessionId).toBeNull();
  });

  it("multiple records on the same test run are all returned by listByTestRun()", async () => {
    const companyId = await seedCompany("mul");
    const run = await runStore.create({ companyId, dimension: "mobile", prRef: "pr-mob-3" });

    await store.record(run.id, { platform: "ios", deviceModel: "iPhone 14", osVersion: "16.0" });
    await store.record(run.id, { platform: "android", deviceModel: "Galaxy S24", osVersion: "14" });
    await store.record(run.id, { platform: "ios", deviceModel: "iPad Air", osVersion: "17.0", status: "failed" });

    const list = await store.listByTestRun(run.id);
    expect(list).toHaveLength(3);

    const failed = list.filter((r) => r.status === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].deviceModel).toBe("iPad Air");
  });

  it("listByTestRun() is scoped to the given test run id", async () => {
    const companyId = await seedCompany("scp");
    const run1 = await runStore.create({ companyId, dimension: "mobile", prRef: "pr-mob-scope-1" });
    const run2 = await runStore.create({ companyId, dimension: "mobile", prRef: "pr-mob-scope-2" });

    await store.record(run1.id, { platform: "ios", deviceModel: "iPhone SE", osVersion: "16.0" });
    await store.record(run2.id, { platform: "android", deviceModel: "Moto G", osVersion: "13" });

    const list1 = await store.listByTestRun(run1.id);
    expect(list1).toHaveLength(1);
    expect(list1[0].deviceModel).toBe("iPhone SE");

    const list2 = await store.listByTestRun(run2.id);
    expect(list2).toHaveLength(1);
    expect(list2[0].deviceModel).toBe("Moto G");
  });
});
