// Integration tests for SagaOrchestrator.
// Gate criteria:
//   Happy path: 3 steps run forward → all done, saga status=done.
//   Failure path: step 2 fails → step 1 compensates → saga status=aborted.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  companies,
  createDb,
} from "@paperclipai/db";
import { sql } from "drizzle-orm";
import { sagas } from "@paperclipai/db/schema/sagas";
import { sagaSteps } from "@paperclipai/db/schema/saga_steps";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { SagaOrchestrator } from "../saga-orchestrator.js";
import { eq } from "drizzle-orm";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping SagaOrchestrator integration: ${support.reason ?? "unsupported"}`);
}

desc("SagaOrchestrator integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let companyId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("saga-orchestrator-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM saga_steps`);
    await db.execute(sql`DELETE FROM sagas`);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedCompany(prefix: string): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name: `SagaCo-${prefix}`,
      issuePrefix: `SG${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("happy path: 3 steps run forward, all done, saga=done", async () => {
    companyId = await seedCompany("happy");
    const executed: string[] = [];
    const orchestrator = new SagaOrchestrator(
      db,
      async (step) => { executed.push(`fwd:${step.name}`); },
      async () => {},
    );

    const { sagaId } = await orchestrator.start(companyId, "deploy-feature", [
      { name: "step-1", forwardAction: { op: "deploy-api" } },
      { name: "step-2", forwardAction: { op: "deploy-ui" } },
      { name: "step-3", forwardAction: { op: "verify-e2e" } },
    ]);

    await orchestrator.tick(sagaId);
    await orchestrator.tick(sagaId);
    await orchestrator.tick(sagaId);

    const [saga] = await db.select().from(sagas).where(eq(sagas.id, sagaId));
    expect(saga.status).toBe("done");
    expect(saga.outcome).toBe("success");
    expect(saga.finishedAt).not.toBeNull();

    const steps = await db.select().from(sagaSteps).where(eq(sagaSteps.sagaId, sagaId));
    for (const s of steps) {
      expect(s.status).toBe("done");
    }

    expect(executed).toEqual(["fwd:step-1", "fwd:step-2", "fwd:step-3"]);
  });

  it("failure path: step 2 fails → step 1 compensates → saga=aborted", async () => {
    companyId = await seedCompany("fail");
    const compensated: string[] = [];

    const orchestrator = new SagaOrchestrator(
      db,
      async (step) => {
        if (step.name === "step-2") throw new Error("step-2 boom");
      },
      async (step) => { compensated.push(`comp:${step.name}`); },
    );

    const { sagaId } = await orchestrator.start(companyId, "deploy-broken", [
      { name: "step-1", forwardAction: { op: "deploy-api" }, compensateAction: { op: "rollback-api" } },
      { name: "step-2", forwardAction: { op: "deploy-ui" }, compensateAction: { op: "rollback-ui" } },
      { name: "step-3", forwardAction: { op: "verify" } },
    ]);

    // step-1 succeeds
    await orchestrator.tick(sagaId);
    // step-2 fails → triggers compensation
    await orchestrator.tick(sagaId);

    const [saga] = await db.select().from(sagas).where(eq(sagas.id, sagaId));
    expect(saga.status).toBe("aborted");

    const steps = await db
      .select()
      .from(sagaSteps)
      .where(eq(sagaSteps.sagaId, sagaId));

    const step1 = steps.find((s) => s.name === "step-1");
    const step2 = steps.find((s) => s.name === "step-2");
    const step3 = steps.find((s) => s.name === "step-3");

    expect(step1?.status).toBe("compensated");
    expect(step2?.status).toBe("failed");
    expect(step3?.status).toBe("pending"); // never ran

    // compensated in REVERSE order (only step-1 was done)
    expect(compensated).toEqual(["comp:step-1"]);
  });

  it("TC-CP-07: cross-repo 3-repo deploy, repo-3 fails → repos 1+2 rollback, saga=aborted", async () => {
    companyId = await seedCompany("xrep");
    const forwardCalls: string[] = [];
    const compensated: string[] = [];

    const orchestrator = new SagaOrchestrator(
      db,
      async (step) => {
        forwardCalls.push(`fwd:${step.name}`);
        if (step.name === "repo-3") throw new Error("repo-3 deploy timeout");
      },
      async (step) => {
        compensated.push(`comp:${step.name}`);
      },
    );

    const { sagaId } = await orchestrator.start(companyId, "auth-redesign", [
      { name: "repo-1", forwardAction: { op: "deploy" }, compensateAction: { op: "rollback" } },
      { name: "repo-2", forwardAction: { op: "deploy" }, compensateAction: { op: "rollback" } },
      { name: "repo-3", forwardAction: { op: "deploy" }, compensateAction: { op: "rollback" } },
    ]);

    await orchestrator.tick(sagaId); // repo-1 done
    await orchestrator.tick(sagaId); // repo-2 done
    await orchestrator.tick(sagaId); // repo-3 fail → compensation cascade

    const [saga] = await db.select().from(sagas).where(eq(sagas.id, sagaId));
    expect(saga.status).toBe("aborted");

    const steps = await db.select().from(sagaSteps).where(eq(sagaSteps.sagaId, sagaId));
    const r1 = steps.find((s) => s.name === "repo-1");
    const r2 = steps.find((s) => s.name === "repo-2");
    const r3 = steps.find((s) => s.name === "repo-3");

    // No partial deploy: 1+2 rolled back, 3 failed
    expect(r1?.status).toBe("compensated");
    expect(r2?.status).toBe("compensated");
    expect(r3?.status).toBe("failed");

    // Forward called for all 3 (3 attempted before fail)
    expect(forwardCalls).toEqual(["fwd:repo-1", "fwd:repo-2", "fwd:repo-3"]);

    // Compensation in REVERSE order (LIFO of completed steps)
    expect(compensated).toEqual(["comp:repo-2", "comp:repo-1"]);
  });

  it("tick on done saga is a no-op", async () => {
    companyId = await seedCompany("noop");
    const orchestrator = new SagaOrchestrator(
      db,
      async () => {},
      async () => {},
    );

    const { sagaId } = await orchestrator.start(companyId, "one-step", [
      { name: "step-1" },
    ]);

    await orchestrator.tick(sagaId); // completes
    // Extra tick should not throw
    await expect(orchestrator.tick(sagaId)).resolves.toBeUndefined();
  });
});
