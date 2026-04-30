// Integration tests for HealthMetricsCollector.
// Gate criteria:
//   • record value below threshold × 0.7 → status='green'
//   • record value at threshold × 0.8 (between 0.7 and 1.0) → status='yellow'
//   • record value above threshold → status='red'
//   • higher-is-better kind: value ≥ threshold × 0.7 → green
//   • higher-is-better kind: value ≥ threshold × 0.5 but < threshold × 0.7 → yellow
//   • higher-is-better kind: value < threshold × 0.5 → red
//   • recent() returns rows ordered desc by recorded_at
//   • latestStatus() returns current status

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { HealthMetricsCollector, computeHealthStatus } from "../health-metrics-collector.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping HealthMetricsCollector integration: ${support.reason ?? "unsupported"}`);
}

// ---------------------------------------------------------------------------
// Pure unit tests for computeHealthStatus (no DB needed)
// ---------------------------------------------------------------------------

describe("computeHealthStatus (pure)", () => {
  it("lower-is-better: value ≤ threshold × 0.7 → green", () => {
    expect(computeHealthStatus("latency_p50", 60, 100)).toBe("green");
    expect(computeHealthStatus("latency_p50", 70, 100)).toBe("green");
  });

  it("lower-is-better: value between threshold × 0.7 and threshold → yellow", () => {
    expect(computeHealthStatus("error_rate", 80, 100)).toBe("yellow");
    expect(computeHealthStatus("brier", 0.14, 0.15)).toBe("yellow");
  });

  it("lower-is-better: value > threshold → red", () => {
    expect(computeHealthStatus("latency_p95", 110, 100)).toBe("red");
    expect(computeHealthStatus("cost_per_hour", 200, 100)).toBe("red");
  });

  it("higher-is-better: value ≥ threshold × 0.7 → green", () => {
    expect(computeHealthStatus("gate_compliance", 0.85, 0.8)).toBe("green");
    expect(computeHealthStatus("trust_promotion_rate", 0.56, 0.8)).toBe("green");
  });

  it("higher-is-better: value ≥ threshold × 0.5 but < threshold × 0.7 → yellow", () => {
    expect(computeHealthStatus("gate_compliance", 0.45, 0.8)).toBe("yellow");
  });

  it("higher-is-better: value < threshold × 0.5 → red", () => {
    expect(computeHealthStatus("trust_promotion_rate", 0.3, 0.8)).toBe("red");
  });

  it("no threshold → green regardless", () => {
    expect(computeHealthStatus("latency_p50", 9999, undefined)).toBe("green");
  });
});

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

desc("HealthMetricsCollector integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let collector!: HealthMetricsCollector;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("health-metrics-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    collector = new HealthMetricsCollector(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM system_health_metrics`);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedCompany(prefix: string): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name: `HMCo-${prefix}`,
      issuePrefix: `HM${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("record value below 70% of threshold → status=green", async () => {
    const companyId = await seedCompany("green");
    const row = await collector.record({
      companyId,
      scope: "workspace",
      kind: "latency_p50",
      value: 60,
      threshold: 100,
    });
    expect(row.status).toBe("green");
    expect(row.value).toBe(60);
    expect(row.threshold).toBe(100);
  });

  it("record value at 80% of threshold → status=yellow", async () => {
    const companyId = await seedCompany("yellow");
    const row = await collector.record({
      companyId,
      scope: "workspace",
      kind: "error_rate",
      value: 80,
      threshold: 100,
    });
    expect(row.status).toBe("yellow");
  });

  it("record value above threshold → status=red", async () => {
    const companyId = await seedCompany("red");
    const row = await collector.record({
      companyId,
      scope: "service",
      kind: "latency_p95",
      value: 150,
      threshold: 100,
    });
    expect(row.status).toBe("red");
  });

  it("recent() returns rows ordered desc by recorded_at", async () => {
    const companyId = await seedCompany("recent");
    for (let i = 0; i < 3; i++) {
      await collector.record({
        companyId,
        scope: "workspace",
        kind: "cost_per_hour",
        value: i * 10,
        threshold: 100,
      });
    }
    const rows = await collector.recent(companyId, "workspace", "cost_per_hour");
    expect(rows).toHaveLength(3);
    for (let i = 0; i < rows.length - 1; i++) {
      expect(rows[i].recordedAt.getTime()).toBeGreaterThanOrEqual(
        rows[i + 1].recordedAt.getTime(),
      );
    }
  });

  it("latestStatus() returns the most recently inserted status", async () => {
    const companyId = await seedCompany("latest");
    await collector.record({ companyId, scope: "workspace", kind: "brier", value: 200, threshold: 100 });
    await collector.record({ companyId, scope: "workspace", kind: "brier", value: 50, threshold: 100 });
    const status = await collector.latestStatus(companyId, "workspace", "brier");
    expect(status).toBe("green");
  });

  it("record with scopeId and payload persists correctly", async () => {
    const companyId = await seedCompany("payload");
    const row = await collector.record({
      companyId,
      scope: "mission",
      scopeId: "mission-123",
      kind: "stuck_event_rate",
      value: 0.5,
      threshold: 1.0,
      payload: { note: "test-payload" },
    });
    expect(row.scopeId).toBe("mission-123");
    expect(row.payload).toMatchObject({ note: "test-payload" });
  });
});
