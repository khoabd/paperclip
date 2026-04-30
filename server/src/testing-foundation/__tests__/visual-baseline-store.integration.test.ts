// Integration tests for VisualBaselineStore.
// Gate criteria:
//   register → findActive returns it → archive → findActive returns null.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { VisualBaselineStore } from "../visual-baseline-store.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping VisualBaselineStore integration: ${support.reason ?? "unsupported"}`);
}

desc("VisualBaselineStore integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let store!: VisualBaselineStore;
  let companyId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("visual-baseline-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    store = new VisualBaselineStore(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM visual_baselines`);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedCompany(prefix: string): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name: `VisualCo-${prefix}`,
      issuePrefix: `VB${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("register → findActive returns the new baseline", async () => {
    companyId = await seedCompany("reg");

    const row = await store.register({
      company: companyId,
      route: "/dashboard",
      viewport: "1440x900",
      browser: "chromium",
      imageUri: "s3://bucket/baseline-1.png",
      sha: "sha256:aaa111",
    });

    expect(row.companyId).toBe(companyId);
    expect(row.route).toBe("/dashboard");
    expect(row.archived).toBe(false);

    const found = await store.findActive(companyId, "/dashboard", "1440x900", "chromium");
    expect(found).not.toBeNull();
    expect(found!.id).toBe(row.id);
    expect(found!.sha).toBe("sha256:aaa111");
  });

  it("archive → findActive returns null", async () => {
    companyId = await seedCompany("arc");

    const row = await store.register({
      company: companyId,
      route: "/settings",
      viewport: "1280x800",
      browser: "firefox",
      imageUri: "s3://bucket/settings-1.png",
      sha: "sha256:bbb222",
    });

    await store.archive(row.id);

    const found = await store.findActive(companyId, "/settings", "1280x800", "firefox");
    expect(found).toBeNull();
  });

  it("register replaces old baseline by archiving it", async () => {
    companyId = await seedCompany("rep");

    const first = await store.register({
      company: companyId,
      route: "/home",
      viewport: "1440x900",
      browser: "webkit",
      imageUri: "s3://bucket/home-v1.png",
      sha: "sha256:v1",
    });

    const second = await store.register({
      company: companyId,
      route: "/home",
      viewport: "1440x900",
      browser: "webkit",
      imageUri: "s3://bucket/home-v2.png",
      sha: "sha256:v2",
    });

    // Old baseline is now archived
    const found = await store.findActive(companyId, "/home", "1440x900", "webkit");
    expect(found).not.toBeNull();
    expect(found!.id).toBe(second.id);
    expect(found!.sha).toBe("sha256:v2");
    // first is now archived (different id)
    expect(found!.id).not.toBe(first.id);
  });

  it("findActive returns null when no baseline exists", async () => {
    companyId = await seedCompany("none");
    const found = await store.findActive(companyId, "/missing", "375x667", "chromium");
    expect(found).toBeNull();
  });
});
