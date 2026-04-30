// Integration tests for SyntheticProbeRunner.
// Gate criteria:
//   • recordResult 5 entries → recentForEnv returns all 5 sorted desc by occurred_at.
//   • recentForEnv respects env filter (live vs stag).
//   • recentForEnv respects lookback window (old entries excluded).

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { SyntheticProbeRunner } from "../synthetic-probe-runner.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping SyntheticProbeRunner integration: ${support.reason ?? "unsupported"}`);
}

desc("SyntheticProbeRunner integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let probeRunner!: SyntheticProbeRunner;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("synthetic-probe-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    probeRunner = new SyntheticProbeRunner(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM synthetic_probe_results`);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedCompany(prefix: string): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name: `SpCo-${prefix}`,
      issuePrefix: `SP${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("recordResult 5 entries → recentForEnv returns 5 sorted desc by occurred_at", async () => {
    const companyId = await seedCompany("five");

    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      await probeRunner.recordResult({
        companyId,
        probeName: `probe-${i}`,
        env: "live",
        status: "passed",
        latencyMs: 100 + i * 10,
        occurredAt: new Date(base + i * 1000),
      });
    }

    const results = await probeRunner.recentForEnv(companyId, "live", 60);
    expect(results).toHaveLength(5);

    // Verify descending order
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].occurredAt.getTime()).toBeGreaterThanOrEqual(
        results[i + 1].occurredAt.getTime(),
      );
    }
  });

  it("recentForEnv filters by env — stag entries not returned for live", async () => {
    const companyId = await seedCompany("env");

    await probeRunner.recordResult({
      companyId,
      probeName: "probe-live",
      env: "live",
      status: "passed",
    });
    await probeRunner.recordResult({
      companyId,
      probeName: "probe-stag",
      env: "stag",
      status: "failed",
    });

    const liveResults = await probeRunner.recentForEnv(companyId, "live", 60);
    expect(liveResults).toHaveLength(1);
    expect(liveResults[0].probeName).toBe("probe-live");
  });

  it("recentForEnv excludes entries older than lookback window", async () => {
    const companyId = await seedCompany("old");

    // Insert an entry that is 2 hours old
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await probeRunner.recordResult({
      companyId,
      probeName: "old-probe",
      env: "live",
      status: "failed",
      occurredAt: oldTime,
    });

    // Insert a recent entry
    await probeRunner.recordResult({
      companyId,
      probeName: "new-probe",
      env: "live",
      status: "passed",
    });

    // lookback 30 min → only the recent one
    const results = await probeRunner.recentForEnv(companyId, "live", 30);
    expect(results).toHaveLength(1);
    expect(results[0].probeName).toBe("new-probe");
  });
});
