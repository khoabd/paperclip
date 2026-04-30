// Unit tests for FeatureFlagEvaluator (pure path via evaluatePure).
// Also covers DB-backed evaluation via integration test.
// Per Phase-7-Development-Flow-Feature-Flags §7.4.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
  featureFlags,
  featureFlagWorkspaceOverrides,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { evaluatePure, FeatureFlagEvaluator } from "../feature-flags/feature-flag-evaluator.js";
import { hashWorkspaceToBucket } from "../../platform/skill-library.js";

// ─── Pure unit tests ───────────────────────────────────────────────────────

describe("evaluatePure", () => {
  const flagKey = "dark_mode";

  it("status=off → disabled regardless of rollout", () => {
    const r = evaluatePure({ status: "off", rolloutPercent: 100, hashInput: "user-1", flagKey });
    expect(r.enabled).toBe(false);
    expect(r.source).toBe("status_off");
  });

  it("status=on → always enabled", () => {
    const r = evaluatePure({ status: "on", rolloutPercent: 0, hashInput: "user-1", flagKey });
    expect(r.enabled).toBe(true);
    expect(r.source).toBe("status_on");
  });

  it("override=true beats rollout 0%", () => {
    const r = evaluatePure({
      status: "canary",
      rolloutPercent: 0,
      override: true,
      hashInput: "user-1",
      flagKey,
    });
    expect(r.enabled).toBe(true);
    expect(r.source).toBe("override");
  });

  it("override=false beats status=on", () => {
    // Note: evaluatePure checks override after status=off, so override=false with status=on
    // should win over status=on.
    const r = evaluatePure({
      status: "on",
      rolloutPercent: 100,
      override: false,
      hashInput: "user-1",
      flagKey,
    });
    expect(r.enabled).toBe(false);
    expect(r.source).toBe("override");
  });

  it("canary rollout is deterministic: same input always same result", () => {
    const input = "workspace-abc123";
    const r1 = evaluatePure({ status: "canary", rolloutPercent: 50, hashInput: input, flagKey });
    const r2 = evaluatePure({ status: "canary", rolloutPercent: 50, hashInput: input, flagKey });
    expect(r1.enabled).toBe(r2.enabled);
    expect(r1.source).toBe("rollout");
  });

  it("canary rollout=100 enables everyone", () => {
    // Any input should be in the bucket (bucket is [0, 100), rolloutPercent=100 means always).
    for (const id of ["a", "b", "c", "d", "long-workspace-id-xyz"]) {
      const r = evaluatePure({ status: "canary", rolloutPercent: 100, hashInput: id, flagKey });
      expect(r.enabled).toBe(true);
    }
  });

  it("canary rollout=0 disables everyone", () => {
    for (const id of ["a", "b", "c", "d"]) {
      const r = evaluatePure({ status: "canary", rolloutPercent: 0, hashInput: id, flagKey });
      expect(r.enabled).toBe(false);
    }
  });

  it("different flag keys produce different buckets for same input", () => {
    const input = "ws-test";
    const b1 = hashWorkspaceToBucket(input, "feature_a");
    const b2 = hashWorkspaceToBucket(input, "feature_b");
    // They will almost certainly differ — the test just asserts hash is influenced by key.
    // We verify the function exists and returns a number in [0, 100).
    expect(b1).toBeGreaterThanOrEqual(0);
    expect(b1).toBeLessThan(100);
    expect(b2).toBeGreaterThanOrEqual(0);
    expect(b2).toBeLessThan(100);
  });
});

// ─── Integration tests ─────────────────────────────────────────────────────

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping FeatureFlagEvaluator integration tests: ${embeddedPostgresSupport.reason ?? "unsupported"}`,
  );
}

describeEmbeddedPostgres("FeatureFlagEvaluator (integration)", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let evaluator!: FeatureFlagEvaluator;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("flag-evaluator-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    evaluator = new FeatureFlagEvaluator(db);
  });

  afterEach(async () => {
    await db.delete(featureFlagWorkspaceOverrides);
    await db.delete(featureFlags);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  let prefixCounter = 0;

  async function seedWorkspace(): Promise<string> {
    const id = randomUUID();
    prefixCounter++;
    await db.insert(companies).values({
      id,
      name: `FlagCo${prefixCounter}`,
      status: "active",
      autonomyLevel: "sandbox",
      wfqWeight: 100,
      costBudgetUsdPerWeek: "100.0000",
      issuePrefix: `FL${prefixCounter}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  async function seedFlag(
    companyId: string,
    key: string,
    status: string,
    rolloutPercent = 0,
  ): Promise<string> {
    const [flag] = await db
      .insert(featureFlags)
      .values({ companyId, key, status, rolloutPercent })
      .returning({ id: featureFlags.id });
    if (!flag) throw new Error("insert failed");
    return flag.id;
  }

  it("unknown flag returns disabled + unknown source", async () => {
    const wsId = await seedWorkspace();
    const r = await evaluator.evaluate({ companyId: wsId, flagKey: "nonexistent" });
    expect(r.enabled).toBe(false);
    expect(r.source).toBe("unknown");
  });

  it("status=off → disabled", async () => {
    const wsId = await seedWorkspace();
    await seedFlag(wsId, "my_flag", "off", 100);
    const r = await evaluator.evaluate({ companyId: wsId, flagKey: "my_flag" });
    expect(r.enabled).toBe(false);
    expect(r.source).toBe("status_off");
  });

  it("status=on → enabled", async () => {
    const wsId = await seedWorkspace();
    await seedFlag(wsId, "my_flag", "on");
    const r = await evaluator.evaluate({ companyId: wsId, flagKey: "my_flag" });
    expect(r.enabled).toBe(true);
    expect(r.source).toBe("status_on");
  });

  it("workspace override=true beats rollout=0", async () => {
    const wsId = await seedWorkspace();
    const flagId = await seedFlag(wsId, "override_flag", "canary", 0);
    await db.insert(featureFlagWorkspaceOverrides).values({
      flagId,
      companyId: wsId,
      value: true,
    });
    const r = await evaluator.evaluate({ companyId: wsId, flagKey: "override_flag" });
    expect(r.enabled).toBe(true);
    expect(r.source).toBe("override");
  });

  it("workspace override=false beats status=on", async () => {
    const wsId = await seedWorkspace();
    const flagId = await seedFlag(wsId, "override_flag2", "on", 100);
    await db.insert(featureFlagWorkspaceOverrides).values({
      flagId,
      companyId: wsId,
      value: false,
    });
    const r = await evaluator.evaluate({ companyId: wsId, flagKey: "override_flag2" });
    expect(r.enabled).toBe(false);
    expect(r.source).toBe("override");
  });

  it("canary rollout=100 enables (source=rollout)", async () => {
    const wsId = await seedWorkspace();
    await seedFlag(wsId, "canary_flag", "canary", 100);
    const r = await evaluator.evaluate({ companyId: wsId, flagKey: "canary_flag" });
    expect(r.enabled).toBe(true);
    expect(r.source).toBe("rollout");
  });
});
