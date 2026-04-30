// TC-CP-08: Hotfix forward-port — clean / simple-conflict / deep-conflict.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { approvals, companies, createDb, hotfixAttempts } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import {
  HotfixRunner,
  type CherryPickAdapter,
  type CherryPickResult,
  type MergeAgent,
} from "../hotfix-runner.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping HotfixRunner integration: ${support.reason ?? "unsupported"}`);
}

function staticPicker(result: CherryPickResult): CherryPickAdapter {
  return { cherryPick: async () => result };
}
function staticAgent(resolved: boolean, reason?: string): MergeAgent {
  return { attemptResolve: async () => ({ resolved, reason }) };
}

desc("HotfixRunner — TC-CP-08", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let companyId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("hotfix-runner-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Hotfix Co",
      status: "active",
      autonomyLevel: "supervised",
      issuePrefix: `HFX-${companyId.slice(0, 6)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterEach(async () => {
    await db.delete(hotfixAttempts);
    await db.delete(approvals);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  const runInput = {
    companyId: "",
    sourceBranch: "release/1.5",
    targetBranch: "main",
    commitSha: "abc123",
  };

  it("Case 1 — clean cherry-pick → outcome=clean, no approval", async () => {
    const runner = new HotfixRunner(db, staticPicker({ kind: "clean" }), staticAgent(true));
    const result = await runner.run({ ...runInput, companyId });

    expect(result.outcome).toBe("clean");
    expect(result.approvalId).toBeNull();
    expect(result.agentAttempts).toBe(0);

    const [row] = await db.select().from(hotfixAttempts).where(eq(hotfixAttempts.id, result.attemptId));
    expect(row.outcome).toBe("clean");
    expect(row.conflictSeverity).toBeNull();
    expect(row.finishedAt).toBeTruthy();

    const approvalRows = await db.select().from(approvals).where(eq(approvals.companyId, companyId));
    expect(approvalRows).toHaveLength(0);
  });

  it("Case 2 — simple conflict resolved by agent → outcome=auto_resolved, no approval", async () => {
    const picker = staticPicker({ kind: "conflict", severity: "simple", affectedFiles: ["a.ts"] });
    const agent = staticAgent(true);
    const runner = new HotfixRunner(db, picker, agent);

    const result = await runner.run({ ...runInput, companyId });
    expect(result.outcome).toBe("auto_resolved");
    expect(result.conflictSeverity).toBe("simple");
    expect(result.approvalId).toBeNull();
    expect(result.agentAttempts).toBe(1);

    const approvalRows = await db.select().from(approvals).where(eq(approvals.companyId, companyId));
    expect(approvalRows).toHaveLength(0);
  });

  it("Case 3 — deep conflict (severity=deep) → outcome=escalated, approval created HIGH", async () => {
    const picker = staticPicker({
      kind: "conflict",
      severity: "deep",
      affectedFiles: ["a.ts", "b.ts", "c.ts", "d.ts"],
    });
    const runner = new HotfixRunner(db, picker, staticAgent(false));

    const result = await runner.run({ ...runInput, companyId });
    expect(result.outcome).toBe("escalated");
    expect(result.conflictSeverity).toBe("deep");
    expect(result.approvalId).toBeTruthy();

    const [approval] = await db.select().from(approvals).where(eq(approvals.id, result.approvalId!));
    expect(approval.type).toBe("hotfix_conflict");
    expect(approval.priority).toBe("high");
    expect(approval.riskLevel).toBe("high");
    const payload = approval.payload as Record<string, unknown>;
    expect(payload.commitSha).toBe(runInput.commitSha);
  });

  it("Case 3 alt — many files (≥3) auto-classifies as deep even if picker said simple", async () => {
    const picker = staticPicker({
      kind: "conflict",
      severity: "simple",
      affectedFiles: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
    });
    const runner = new HotfixRunner(db, picker, staticAgent(true));

    const result = await runner.run({ ...runInput, companyId });
    expect(result.outcome).toBe("escalated");
    expect(result.conflictSeverity).toBe("deep");
  });

  it("simple conflict + agent fails → escalate with severity=simple but approval still created", async () => {
    const picker = staticPicker({
      kind: "conflict",
      severity: "simple",
      affectedFiles: ["a.ts"],
    });
    const agent = staticAgent(false, "ambiguous merge");
    const runner = new HotfixRunner(db, picker, agent);

    const result = await runner.run({ ...runInput, companyId });
    expect(result.outcome).toBe("escalated");
    expect(result.conflictSeverity).toBe("simple");
    expect(result.approvalId).toBeTruthy();
    expect(result.agentAttempts).toBe(1);

    const [approval] = await db.select().from(approvals).where(eq(approvals.id, result.approvalId!));
    const payload = approval.payload as Record<string, unknown>;
    expect(payload.context).toContain("ambiguous merge");
  });

  it("hotfix_attempts row written for every case (audit trail)", async () => {
    const cleanRunner = new HotfixRunner(db, staticPicker({ kind: "clean" }), staticAgent(true));
    await cleanRunner.run({ ...runInput, companyId, commitSha: "case1" });

    const simpleRunner = new HotfixRunner(
      db,
      staticPicker({ kind: "conflict", severity: "simple", affectedFiles: ["a.ts"] }),
      staticAgent(true),
    );
    await simpleRunner.run({ ...runInput, companyId, commitSha: "case2" });

    const deepRunner = new HotfixRunner(
      db,
      staticPicker({ kind: "conflict", severity: "deep", affectedFiles: ["a.ts", "b.ts", "c.ts"] }),
      staticAgent(false),
    );
    await deepRunner.run({ ...runInput, companyId, commitSha: "case3" });

    const rows = await db.select().from(hotfixAttempts).where(eq(hotfixAttempts.companyId, companyId));
    expect(rows.map((r) => r.outcome).sort()).toEqual(["auto_resolved", "clean", "escalated"]);
  });
});
