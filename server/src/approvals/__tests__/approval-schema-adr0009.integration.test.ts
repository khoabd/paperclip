// TC-INT-APPROVAL-SCHEMA-01: Approvals 11 cột mới — migration backward compat + Zod schemas.
// Verifies that existing approvals rows survive ADR-0009 column additions and that the Zod
// discriminatedUnion enforces per-pattern payload contracts.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { approvals, companies, createDb } from "@paperclipai/db";
import {
  ApprovalPayloadByPattern,
  validateApprovalPayload,
} from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping ADR-0009 schema integration: ${support.reason ?? "unsupported"}`);
}

const ADR0009_COLUMNS = [
  "proposal_pattern",
  "confidence",
  "risk_score",
  "risk_level",
  "priority",
  "timeout_hours",
  "timeout_action",
  "can_delegate",
  "delegated_to_user_id",
  "time_to_decision_seconds",
  "metadata",
] as const;

desc("Approvals ADR-0009 schema — TC-INT-APPROVAL-SCHEMA-01", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let companyId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("approvals-adr0009-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "ADR-0009 Test Co",
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

  it("all 11 ADR-0009 columns exist on approvals table", async () => {
    const rows = (await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'approvals'
        AND table_schema = current_schema()
    `)) as unknown as Array<{ column_name: string }>;
    const list = Array.isArray(rows) ? rows : (rows as { rows?: Array<{ column_name: string }> }).rows ?? [];
    const present = new Set(list.map((r) => r.column_name));
    for (const col of ADR0009_COLUMNS) {
      expect(present.has(col), `expected column ${col}`).toBe(true);
    }
  });

  it("backward compat — pre-ADR-0009 minimal row reads back, new cols default safely", async () => {
    const id = randomUUID();
    await db.insert(approvals).values({
      id,
      companyId,
      type: "hire_agent",
      payload: { agentId: randomUUID() },
      status: "pending",
    });

    const [row] = await db.select().from(approvals).where(eq(approvals.id, id));
    expect(row).toBeDefined();
    expect(row.type).toBe("hire_agent");
    expect(row.priority).toBe("medium");
    expect(row.canDelegate).toBe(false);
    expect(row.metadata).toEqual({});
    expect(row.riskLevel).toBeNull();
    expect(row.timeoutHours).toBeNull();
    expect(row.timeoutAction).toBeNull();
    expect(row.timeToDecisionSeconds).toBeNull();
  });

  it("inserts a full ADR-0009 row with every new field populated", async () => {
    const id = randomUUID();
    const delegateUserId = `usr_${randomUUID().slice(0, 8)}`;
    await db.insert(approvals).values({
      id,
      companyId,
      type: "code_change",
      proposalPattern: "confirm",
      payload: { action: { kind: "deploy", summary: "Deploy v1.2.3" } },
      status: "pending",
      confidence: "0.8500",
      riskScore: "0.3200",
      riskLevel: "medium",
      priority: "high",
      timeoutHours: 4,
      timeoutAction: "escalate",
      canDelegate: true,
      delegatedToUserId: delegateUserId,
      timeToDecisionSeconds: null,
      metadata: { surface: "approval-center", batchId: "b-42", dragIn: false },
    });

    const [row] = await db.select().from(approvals).where(eq(approvals.id, id));
    expect(row.riskLevel).toBe("medium");
    expect(row.timeoutHours).toBe(4);
    expect(row.timeoutAction).toBe("escalate");
    expect(row.canDelegate).toBe(true);
    expect(row.delegatedToUserId).toBe(delegateUserId);
    expect(row.metadata).toMatchObject({ surface: "approval-center", batchId: "b-42" });
  });

  it("Zod confirm payload — valid action passes, invalid rejects", () => {
    const valid = validateApprovalPayload("confirm", {
      action: { kind: "deploy", summary: "Deploy v1.2.3" },
    });
    expect(valid.ok).toBe(true);

    const invalid = validateApprovalPayload("confirm", { action: { kind: "" } });
    expect(invalid.ok).toBe(false);
  });

  it("Zod choose payload — needs >=2 options, rejects single-option", () => {
    const valid = validateApprovalPayload("choose", {
      options: [
        { key: "a", label: "Option A", summary: "Path A" },
        { key: "b", label: "Option B", summary: "Path B" },
      ],
    });
    expect(valid.ok).toBe(true);

    const tooFew = validateApprovalPayload("choose", {
      options: [{ key: "a", label: "Only", summary: "Just one" }],
    });
    expect(tooFew.ok).toBe(false);

    const tooMany = validateApprovalPayload("choose", {
      options: Array.from({ length: 8 }, (_, i) => ({
        key: `k${i}`,
        label: `Label ${i}`,
        summary: `Summary ${i}`,
      })),
    });
    expect(tooMany.ok).toBe(false);
  });

  it("Zod edit payload — accepts arbitrary draft + schema, rejects missing draft", () => {
    const valid = validateApprovalPayload("edit", {
      draft: { title: "Sprint plan" },
      schema: { type: "object" },
    });
    expect(valid.ok).toBe(true);

    const invalid = validateApprovalPayload("edit", { schema: {} });
    expect(invalid.ok).toBe(false);
  });

  it("Zod decide payload — context required", () => {
    const valid = validateApprovalPayload("decide", {
      context: "Should we ship today?",
      questions: ["Risk?"],
    });
    expect(valid.ok).toBe(true);

    const invalid = validateApprovalPayload("decide", { context: "" });
    expect(invalid.ok).toBe(false);
  });

  it("Zod discriminatedUnion — wrong pattern/payload combo rejected", () => {
    // Sending choose payload under confirm pattern should fail.
    const result = ApprovalPayloadByPattern.safeParse({
      pattern: "confirm",
      payload: { options: [{ key: "a", label: "A", summary: "A" }] },
    });
    expect(result.success).toBe(false);
  });

  it("metadata JSONB accepts arbitrary risk_factors per ADR-0009 §Future-evolution", async () => {
    const id = randomUUID();
    await db.insert(approvals).values({
      id,
      companyId,
      type: "deploy",
      payload: { action: { kind: "deploy", summary: "x" } },
      status: "pending",
      metadata: {
        riskFactors: [
          { code: "untested_branch", weight: 0.4, rationale: "no CI" },
          { code: "weekend_deploy", weight: 0.2 },
        ],
        dragIn: true,
      },
    });

    const [row] = await db.select().from(approvals).where(eq(approvals.id, id));
    const md = row.metadata as Record<string, unknown>;
    expect(Array.isArray(md.riskFactors)).toBe(true);
    expect((md.riskFactors as unknown[]).length).toBe(2);
    expect(md.dragIn).toBe(true);
  });
});
