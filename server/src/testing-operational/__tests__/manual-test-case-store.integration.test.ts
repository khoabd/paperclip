// Integration tests for ManualTestCaseStore.
// Gate criteria:
//   • Valid transitions persist correctly.
//   • Invalid transitions throw ManualTCTransitionError.
//   • assign() transitions pending → in_progress.
//   • submitResult() transitions in_progress → passed/failed/skipped.
//   • Double-submit (passed → failed) throws.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import {
  ManualTestCaseStore,
  ManualTCTransitionError,
} from "../manual-test-case-store.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping ManualTestCaseStore integration: ${support.reason ?? "unsupported"}`);
}

desc("ManualTestCaseStore integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let store!: ManualTestCaseStore;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("manual-tc-store-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    store = new ManualTestCaseStore(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM manual_test_cases`);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedCompany(prefix: string): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name: `MTCo-${prefix}`,
      issuePrefix: `MT${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("create sets status=pending, completedAt=null", async () => {
    const companyId = await seedCompany("cre");

    const tc = await store.create({
      companyId,
      title: "Verify login flow",
      dimension: "manual_tc",
      createdByUserId: "user-001",
    });

    expect(tc.status).toBe("pending");
    expect(tc.completedAt).toBeNull();
    expect(tc.assignedToUserId).toBeNull();
  });

  it("valid transition pending → in_progress via assign()", async () => {
    const companyId = await seedCompany("asgn");
    const tc = await store.create({
      companyId,
      title: "Check dark mode",
      dimension: "exploratory",
    });

    const assigned = await store.assign(tc.id, "tester-007");
    expect(assigned.status).toBe("in_progress");
    expect(assigned.assignedToUserId).toBe("tester-007");
  });

  it("valid transition in_progress → passed with evidence", async () => {
    const companyId = await seedCompany("pass");
    const tc = await store.create({
      companyId,
      title: "Smoke test signup",
      dimension: "manual_tc",
    });
    await store.assign(tc.id, "tester-001");
    const done = await store.submitResult(tc.id, "passed", "s3://evidence/shot.png");

    expect(done.status).toBe("passed");
    expect(done.result).toBe("passed");
    expect(done.evidenceUri).toBe("s3://evidence/shot.png");
    expect(done.completedAt).not.toBeNull();
  });

  it("valid transition pending → skipped directly", async () => {
    const companyId = await seedCompany("skip");
    const tc = await store.create({
      companyId,
      title: "Optional exploratory",
      dimension: "exploratory",
    });

    const skipped = await store.submitResult(tc.id, "skipped");
    expect(skipped.status).toBe("skipped");
  });

  it("invalid transition pending → passed throws ManualTCTransitionError", async () => {
    const companyId = await seedCompany("inv1");
    const tc = await store.create({
      companyId,
      title: "Invalid jump",
      dimension: "manual_tc",
    });

    await expect(store.submitResult(tc.id, "passed")).rejects.toThrow(
      ManualTCTransitionError,
    );
    await expect(store.submitResult(tc.id, "passed")).rejects.toThrow(
      "pending → passed",
    );
  });

  it("invalid transition passed → failed throws ManualTCTransitionError", async () => {
    const companyId = await seedCompany("inv2");
    const tc = await store.create({
      companyId,
      title: "Double submit",
      dimension: "manual_tc",
    });
    await store.assign(tc.id, "u-1");
    await store.submitResult(tc.id, "passed");

    await expect(store.submitResult(tc.id, "failed")).rejects.toThrow(
      ManualTCTransitionError,
    );
    await expect(store.submitResult(tc.id, "failed")).rejects.toThrow(
      "passed → failed",
    );
  });
});
