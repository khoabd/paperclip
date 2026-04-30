import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  capabilityRegistry,
  companies,
  costAnomalies,
  createDb,
  llmQuotaState,
  missionCostEvents,
  platformAgents,
  platformSkills,
  platformTools,
  skillVersions,
  workspaceCapabilityOverrides,
  workspaceLifecycleEvents,
  workspaceSkillPins,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { Platform } from "../platform.js";
import { hashWorkspaceToBucket } from "../skill-library.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres platform tests: ${embeddedPostgresSupport.reason ?? "unsupported"}`,
  );
}

describeEmbeddedPostgres("Platform layer integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let platform!: Platform;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("platform-layer-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    platform = new Platform(db);
  });

  afterEach(async () => {
    await db.delete(missionCostEvents);
    await db.delete(llmQuotaState);
    await db.delete(costAnomalies);
    await db.delete(workspaceLifecycleEvents);
    await db.delete(workspaceSkillPins);
    await db.delete(workspaceCapabilityOverrides);
    await db.delete(skillVersions);
    await db.delete(platformSkills);
    await db.delete(platformTools);
    await db.delete(platformAgents);
    await db.delete(capabilityRegistry);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedWorkspace(overrides: Partial<typeof companies.$inferInsert> = {}) {
    const id = overrides.id ?? randomUUID();
    await db.insert(companies).values({
      id,
      name: overrides.name ?? "Acme",
      status: "active",
      autonomyLevel: overrides.autonomyLevel ?? "sandbox",
      wfqWeight: overrides.wfqWeight ?? 100,
      costBudgetUsdPerWeek: overrides.costBudgetUsdPerWeek ?? "100.0000",
      ragNamespace: overrides.ragNamespace ?? `ns-${id}`,
      vaultPath: overrides.vaultPath ?? `/vault/${id}`,
      pgSchema: overrides.pgSchema ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("loads workspace context with autonomy/budget/namespace", async () => {
    const id = await seedWorkspace({
      autonomyLevel: "trusted",
      wfqWeight: 250,
      costBudgetUsdPerWeek: "42.5000",
    });
    const ctx = await platform.workspaces.load(id);
    expect(ctx).not.toBeNull();
    expect(ctx?.autonomyLevel).toBe("trusted");
    expect(ctx?.wfqWeight).toBe(250);
    expect(ctx?.costBudgetUsdPerWeek).toBeCloseTo(42.5, 4);
    expect(ctx?.ragNamespace).toBe(`ns-${id}`);
  });

  it("appends to workspace_lifecycle_events", async () => {
    const id = await seedWorkspace();
    await platform.workspaces.logLifecycle({
      workspaceId: id,
      kind: "autonomy.upgraded",
      payload: { from: "sandbox", to: "supervised" },
    });
    const rows = await db
      .select()
      .from(workspaceLifecycleEvents)
      .where(eq(workspaceLifecycleEvents.companyId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("autonomy.upgraded");
    const payload = rows[0]!.payload as { from: string; to: string };
    expect(payload.from).toBe("sandbox");
    expect(payload.to).toBe("supervised");
  });

  it("resolves a pinned skill version", async () => {
    const wsId = await seedWorkspace();
    const skillId = randomUUID();
    await db.insert(platformSkills).values({
      id: skillId,
      key: "code.refactor",
      name: "Refactor",
      kind: "tool",
      canaryPct: 50,
    });
    await db.insert(skillVersions).values([
      { skillId, version: "1.0.0", codePath: "skills/refactor@1.0.0", status: "stable" },
      { skillId, version: "1.1.0-canary", codePath: "skills/refactor@1.1.0", status: "canary" },
    ]);
    await db.insert(workspaceSkillPins).values({
      companyId: wsId,
      skillId,
      pinnedVersion: "1.0.0",
      reason: "ws prefers stable",
    });
    const res = await platform.skills.resolve("code.refactor", wsId);
    expect(res.kind).toBe("pinned");
    if (res.kind === "pinned") {
      expect(res.version).toBe("1.0.0");
      expect(res.codePath).toBe("skills/refactor@1.0.0");
    }
  });

  it("falls through to stable when not in canary bucket and no pin", async () => {
    const skillId = randomUUID();
    await db.insert(platformSkills).values({
      id: skillId,
      key: "code.review",
      name: "Review",
      kind: "tool",
      canaryPct: 1, // very narrow canary
    });
    await db.insert(skillVersions).values([
      { skillId, version: "2.0.0", codePath: "skills/review@2.0.0", status: "stable" },
      { skillId, version: "2.1.0-canary", codePath: "skills/review@2.1.0", status: "canary" },
    ]);
    // Find a workspace ID whose hash bucket >= 1 (overwhelming majority)
    let wsId: string | null = null;
    for (let i = 0; i < 50; i++) {
      const candidate = randomUUID();
      if (hashWorkspaceToBucket(candidate, "code.review") >= 1) {
        wsId = candidate;
        break;
      }
    }
    expect(wsId).not.toBeNull();
    await seedWorkspace({ id: wsId! });
    const res = await platform.skills.resolve("code.review", wsId!);
    expect(res.kind).toBe("stable");
    if (res.kind === "stable") expect(res.version).toBe("2.0.0");
  });

  it("returns missing for an unknown skill", async () => {
    const wsId = await seedWorkspace();
    const res = await platform.skills.resolve("never.exists", wsId);
    expect(res.kind).toBe("missing");
  });

  it("records cost events idempotently and updates the weekly quota", async () => {
    const wsId = await seedWorkspace();
    const callId = `call-${randomUUID()}`;
    const a = await platform.cost.record({
      companyId: wsId,
      modelCallId: callId,
      model: "claude-opus-4-7",
      tokensIn: 1000,
      tokensOut: 500,
      costUsd: 0.123456,
    });
    const b = await platform.cost.record({
      companyId: wsId,
      modelCallId: callId,
      model: "claude-opus-4-7",
      tokensIn: 1000,
      tokensOut: 500,
      costUsd: 0.123456,
    });
    expect(a.recorded).toBe(true);
    expect(b.recorded).toBe(false);
    expect(b.duplicate).toBe(true);

    const events = await db.select().from(missionCostEvents).where(eq(missionCostEvents.companyId, wsId));
    expect(events).toHaveLength(1);

    const quotas = await db.select().from(llmQuotaState).where(eq(llmQuotaState.companyId, wsId));
    expect(quotas).toHaveLength(1);
    expect(quotas[0]!.calls).toBe(1);
    expect(quotas[0]!.tokensUsed).toBe(1500);
  });

  it("looks up tools and platform agents by key/name", async () => {
    await db.insert(platformAgents).values({
      name: "ProductManager",
      role: "product",
      defaultModel: "claude-opus-4-7",
      promptTemplateKey: "pm.system",
    });
    await db.insert(platformTools).values({
      key: "tool.git.commit",
      name: "Git Commit",
      toolName: "git_commit",
      schemaJson: { params: [] },
    });
    const pm = await platform.agents.getByName("ProductManager");
    const tool = await platform.tools.getByKey("tool.git.commit");
    expect(pm?.role).toBe("product");
    expect(tool?.toolName).toBe("git_commit");
  });
});
