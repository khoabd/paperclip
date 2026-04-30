// TC-INT-APPROVAL-TIMEOUT-01: timeout_action mechanics + delegation flow.
// Verifies auto_approve / auto_reject / escalate paths and that delegation gates approval.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { approvals, companies, createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { ApprovalDelegationGuard, ApprovalTimeoutSweeper } from "../timeout-sweeper.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping ApprovalTimeoutSweeper integration: ${support.reason ?? "unsupported"}`);
}

desc("ApprovalTimeoutSweeper — TC-INT-APPROVAL-TIMEOUT-01", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let companyId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("approvals-timeout-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Timeout Test Co",
      status: "active",
      autonomyLevel: "supervised",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterEach(async () => {
    await db.delete(approvals);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedApproval(opts: {
    timeoutHours?: number | null;
    timeoutAction?: "auto_approve" | "auto_reject" | "escalate" | null;
    canDelegate?: boolean;
    delegatedTo?: string | null;
    priority?: string;
    createdHoursAgo?: number;
  }): Promise<string> {
    const id = randomUUID();
    const createdAt = new Date(Date.now() - (opts.createdHoursAgo ?? 0) * 3_600_000);
    await db.insert(approvals).values({
      id,
      companyId,
      type: "deploy",
      payload: { action: { kind: "deploy", summary: "x" } },
      status: "pending",
      priority: opts.priority ?? "medium",
      timeoutHours: opts.timeoutHours ?? null,
      timeoutAction: opts.timeoutAction ?? null,
      canDelegate: opts.canDelegate ?? false,
      delegatedToUserId: opts.delegatedTo ?? null,
      createdAt,
      updatedAt: createdAt,
    });
    return id;
  }

  it("auto_approve: status→approved, time_to_decision_seconds populated", async () => {
    const id = await seedApproval({
      timeoutHours: 1,
      timeoutAction: "auto_approve",
      createdHoursAgo: 1.5, // already past 1h window
    });

    const sweeper = new ApprovalTimeoutSweeper(db);
    const outcomes = await sweeper.sweep();
    expect(outcomes.find((o) => o.approvalId === id)?.action).toBe("auto_approve");

    const [row] = await db.select().from(approvals).where(eq(approvals.id, id));
    expect(row.status).toBe("approved");
    expect(row.outcome).toBe("auto_approved");
    expect(row.timeToDecisionSeconds).toBeGreaterThan(0);
    expect(row.decidedAt).toBeTruthy();
    expect(row.decisionNote).toContain("auto-auto_approve");
  });

  it("auto_reject: status→rejected, outcome=auto_rejected", async () => {
    const id = await seedApproval({
      timeoutHours: 1,
      timeoutAction: "auto_reject",
      createdHoursAgo: 2,
    });

    const sweeper = new ApprovalTimeoutSweeper(db);
    await sweeper.sweep();

    const [row] = await db.select().from(approvals).where(eq(approvals.id, id));
    expect(row.status).toBe("rejected");
    expect(row.outcome).toBe("auto_rejected");
  });

  it("escalate: priority bumps up, canDelegate→false, status stays pending", async () => {
    const id = await seedApproval({
      timeoutHours: 1,
      timeoutAction: "escalate",
      canDelegate: true,
      priority: "medium",
      createdHoursAgo: 1.5,
    });

    const sweeper = new ApprovalTimeoutSweeper(db);
    await sweeper.sweep();

    const [row] = await db.select().from(approvals).where(eq(approvals.id, id));
    expect(row.status).toBe("pending");
    expect(row.priority).toBe("high");
    expect(row.canDelegate).toBe(false);
    expect(row.timeToDecisionSeconds).toBeGreaterThan(0);
  });

  it("does NOT sweep approvals whose timeout window has not elapsed", async () => {
    const id = await seedApproval({
      timeoutHours: 4,
      timeoutAction: "auto_approve",
      createdHoursAgo: 1, // still within window
    });

    const sweeper = new ApprovalTimeoutSweeper(db);
    const outcomes = await sweeper.sweep();
    expect(outcomes.find((o) => o.approvalId === id)).toBeUndefined();

    const [row] = await db.select().from(approvals).where(eq(approvals.id, id));
    expect(row.status).toBe("pending");
  });

  it("does NOT sweep approvals without timeout_action even if expired", async () => {
    const id = await seedApproval({
      timeoutHours: 1,
      timeoutAction: null,
      createdHoursAgo: 5,
    });

    const sweeper = new ApprovalTimeoutSweeper(db);
    const outcomes = await sweeper.sweep();
    expect(outcomes.find((o) => o.approvalId === id)).toBeUndefined();
  });

  describe("delegation guard", () => {
    it("delegate(): sets delegated_to_user_id and rejects non-delegatable rows", async () => {
      const ok = await seedApproval({ canDelegate: true });
      const blocked = await seedApproval({ canDelegate: false });
      const guard = new ApprovalDelegationGuard(db);

      await guard.delegate(ok, "user-bob");
      const [okRow] = await db.select().from(approvals).where(eq(approvals.id, ok));
      expect(okRow.delegatedToUserId).toBe("user-bob");

      await expect(guard.delegate(blocked, "user-eve")).rejects.toThrow(/not delegatable/);
    });

    it("canUserDecide: only delegated user passes once delegation is set", async () => {
      const id = await seedApproval({ canDelegate: true });
      const guard = new ApprovalDelegationGuard(db);

      // Before delegation, anyone is allowed (delegation not active).
      expect((await guard.canUserDecide(id, "user-alice")).allowed).toBe(true);

      await guard.delegate(id, "user-bob");

      expect((await guard.canUserDecide(id, "user-bob")).allowed).toBe(true);
      const denied = await guard.canUserDecide(id, "user-alice");
      expect(denied.allowed).toBe(false);
      expect(denied.reason).toBe("delegated_elsewhere");
    });
  });
});
