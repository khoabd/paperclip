// Integration tests for MigrationOrchestrator.
// Gate criteria:
//   • start → status='running', recordsMigrated=0
//   • recordProgress increments counter correctly (multiple calls)
//   • complete(id, 'completed') → status='completed', finishedAt set
//   • complete(id, 'failed') → status='failed'
//   • get() retrieves row by id
//   • recordError appends to errors array

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { MigrationOrchestrator } from "../migration-orchestrator.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping MigrationOrchestrator integration: ${support.reason ?? "unsupported"}`);
}

desc("MigrationOrchestrator integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let orchestrator!: MigrationOrchestrator;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("migration-orch-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    orchestrator = new MigrationOrchestrator(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM migration_history`);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it("start() opens a row with status=running, recordsMigrated=0", async () => {
    const row = await orchestrator.start({
      source: "paperclip-v1",
      target: "custom-paperclip-v2",
      kind: "paperclip_company_to_workspace",
    });

    expect(row.id).toBeTruthy();
    expect(row.status).toBe("running");
    expect(row.recordsMigrated).toBe(0);
    expect(row.finishedAt).toBeNull();
    expect(row.source).toBe("paperclip-v1");
    expect(row.target).toBe("custom-paperclip-v2");
    expect(row.kind).toBe("paperclip_company_to_workspace");
  });

  it("start() with plan stores plan in errors array", async () => {
    const row = await orchestrator.start({
      source: "src",
      target: "tgt",
      kind: "capability_seed",
      plan: { steps: 10, description: "seed capabilities" },
    });
    expect(row.errors).toHaveLength(1);
    expect((row.errors[0] as Record<string, unknown>).type).toBe("plan");
  });

  it("recordProgress() increments counter", async () => {
    const row = await orchestrator.start({
      source: "src2",
      target: "tgt2",
      kind: "paperclip_issue_to_mission",
    });

    await orchestrator.recordProgress(row.id, 100);
    await orchestrator.recordProgress(row.id, 50);

    const updated = await orchestrator.get(row.id);
    expect(updated?.recordsMigrated).toBe(150);
  });

  it("complete(id, 'completed') finalizes with status=completed and finishedAt set", async () => {
    const row = await orchestrator.start({
      source: "src3",
      target: "tgt3",
      kind: "template_install",
    });
    await orchestrator.recordProgress(row.id, 42);

    const final = await orchestrator.complete(row.id, "completed");
    expect(final.status).toBe("completed");
    expect(final.finishedAt).not.toBeNull();
    expect(final.finishedAt).toBeInstanceOf(Date);
  });

  it("complete(id, 'failed') sets status=failed", async () => {
    const row = await orchestrator.start({
      source: "src4",
      target: "tgt4",
      kind: "capability_seed",
    });

    const final = await orchestrator.complete(row.id, "failed");
    expect(final.status).toBe("failed");
    expect(final.finishedAt).not.toBeNull();
  });

  it("complete(id, 'rolled_back') sets status=rolled_back", async () => {
    const row = await orchestrator.start({
      source: "src5",
      target: "tgt5",
      kind: "paperclip_company_to_workspace",
    });
    const final = await orchestrator.complete(row.id, "rolled_back");
    expect(final.status).toBe("rolled_back");
  });

  it("recordError() appends errors without overwriting", async () => {
    const row = await orchestrator.start({
      source: "src6",
      target: "tgt6",
      kind: "paperclip_issue_to_mission",
    });

    await orchestrator.recordError(row.id, { msg: "constraint violation", row: 5 });
    await orchestrator.recordError(row.id, { msg: "timeout", row: 99 });

    const updated = await orchestrator.get(row.id);
    expect(updated?.errors).toHaveLength(2);
    expect((updated?.errors[0] as Record<string, unknown>).msg).toBe("constraint violation");
    expect((updated?.errors[1] as Record<string, unknown>).msg).toBe("timeout");
  });

  it("get() returns null for unknown id", async () => {
    const result = await orchestrator.get(randomUUID());
    expect(result).toBeNull();
  });

  it("full state flow: start → progress → error → complete", async () => {
    const row = await orchestrator.start({
      source: "old-system",
      target: "new-system",
      kind: "paperclip_company_to_workspace",
    });

    expect(row.status).toBe("running");

    await orchestrator.recordProgress(row.id, 200);
    await orchestrator.recordError(row.id, { msg: "batch 3 partial failure" });
    await orchestrator.recordProgress(row.id, 150);

    const mid = await orchestrator.get(row.id);
    expect(mid?.recordsMigrated).toBe(350);
    expect(mid?.errors).toHaveLength(1);

    const final = await orchestrator.complete(row.id, "completed");
    expect(final.status).toBe("completed");
    expect(final.finishedAt).toBeInstanceOf(Date);
    expect(final.recordsMigrated).toBe(350);
  });
});
