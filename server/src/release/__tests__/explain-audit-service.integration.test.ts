// Integration tests for ExplainAuditService.
// Gate criteria:
//   • recordAction + lookupForAction round-trip returns matching row
//   • lookupForAction returns multiple records in asc order
//   • fullChain is persisted and retrieved correctly
//   • listForCompany filters by actionKind

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { ExplainAuditService } from "../explain-audit-service.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping ExplainAuditService integration: ${support.reason ?? "unsupported"}`);
}

desc("ExplainAuditService integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let svc!: ExplainAuditService;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("explain-audit-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    svc = new ExplainAuditService(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM explain_audit_records`);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedCompany(prefix: string): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name: `EACo-${prefix}`,
      issuePrefix: `EA${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("recordAction + lookupForAction round-trip", async () => {
    const companyId = await seedCompany("rt");
    const actionId = randomUUID();

    const written = await svc.recordAction({
      companyId,
      actionKind: "mission_state_change",
      actionId,
      summary: "Mission moved from planning to executing",
      fullChain: [{ step: "check_gate", result: "pass" }],
    });

    expect(written.id).toBeTruthy();
    expect(written.actionKind).toBe("mission_state_change");
    expect(written.summary).toBe("Mission moved from planning to executing");
    expect(written.fullChain).toHaveLength(1);

    const found = await svc.lookupForAction("mission_state_change", actionId);
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(written.id);
    expect(found[0].fullChain).toEqual([{ step: "check_gate", result: "pass" }]);
  });

  it("lookupForAction returns multiple records in ascending order", async () => {
    const companyId = await seedCompany("multi");
    const actionId = randomUUID();

    await svc.recordAction({
      companyId,
      actionKind: "approval",
      actionId,
      summary: "Initial approval request",
    });
    await svc.recordAction({
      companyId,
      actionKind: "approval",
      actionId,
      summary: "Approval updated with context",
    });

    const records = await svc.lookupForAction("approval", actionId);
    expect(records).toHaveLength(2);
    // First written should be first in ascending order
    expect(records[0].summary).toBe("Initial approval request");
    expect(records[1].summary).toBe("Approval updated with context");
    expect(records[0].createdAt.getTime()).toBeLessThanOrEqual(
      records[1].createdAt.getTime(),
    );
  });

  it("optional decisionLogId and missionId persist as null when omitted", async () => {
    const companyId = await seedCompany("nullable");
    const actionId = randomUUID();

    const row = await svc.recordAction({
      companyId,
      actionKind: "kill",
      actionId,
      summary: "Kill switch activated",
    });

    expect(row.decisionLogId).toBeNull();
    expect(row.missionId).toBeNull();
  });

  it("listForCompany filters by actionKind", async () => {
    const companyId = await seedCompany("filter");

    await svc.recordAction({
      companyId,
      actionKind: "approval",
      actionId: randomUUID(),
      summary: "Approval A",
    });
    await svc.recordAction({
      companyId,
      actionKind: "kill",
      actionId: randomUUID(),
      summary: "Kill B",
    });
    await svc.recordAction({
      companyId,
      actionKind: "approval",
      actionId: randomUUID(),
      summary: "Approval C",
    });

    const approvals = await svc.listForCompany(companyId, "approval");
    expect(approvals).toHaveLength(2);
    expect(approvals.every((r) => r.actionKind === "approval")).toBe(true);

    const kills = await svc.listForCompany(companyId, "kill");
    expect(kills).toHaveLength(1);
  });

  it("fullChain defaults to empty array when not provided", async () => {
    const companyId = await seedCompany("empty-chain");
    const row = await svc.recordAction({
      companyId,
      actionKind: "intake_decision",
      actionId: randomUUID(),
      summary: "Intake classified",
    });
    expect(row.fullChain).toEqual([]);
  });
});
