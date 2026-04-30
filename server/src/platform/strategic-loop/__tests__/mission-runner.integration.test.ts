import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  companies,
  createDb,
  documentRevisions,
  documents,
  missions,
  missionReflections,
  missionStateTransitions,
  missionSteps,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../../__tests__/helpers/embedded-postgres.js";
import { BrainStore } from "../brain-store.js";
import { MissionRunner } from "../mission-runner.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping MissionRunner integration tests: ${embeddedPostgresSupport.reason ?? "unsupported"}`,
  );
}

describeEmbeddedPostgres("MissionRunner", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let brain!: BrainStore;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("mission-runner-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    brain = new BrainStore(db);
  });

  afterEach(async () => {
    await db.delete(missionStateTransitions);
    await db.delete(missionReflections);
    await db.delete(missionSteps);
    await db.delete(missions);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedWorkspace(): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name: "Acme",
      status: "active",
      autonomyLevel: "sandbox",
      wfqWeight: 100,
      costBudgetUsdPerWeek: "100.0000",
      ragNamespace: `ns-${id}`,
      vaultPath: `/vault/${id}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  async function seedMission(workspaceId: string): Promise<string> {
    const id = randomUUID();
    await db.insert(missions).values({
      id,
      companyId: workspaceId,
      title: "Build login",
      goal: "Users can sign in via email",
      status: "intake",
    });
    return id;
  }

  it("drives a full mission intake → planning → executing → reflecting → done", async () => {
    const wsId = await seedWorkspace();
    const missionId = await seedMission(wsId);

    const runner = new MissionRunner({
      db,
      brain,
      planner: async () => ({
        steps: [
          { kind: "design.draft", title: "Sketch login UI" },
          { kind: "code.implement", title: "Wire endpoint" },
        ],
      }),
      reflector: async () => ({
        wantsDone: true,
        finishedOutcome: "shipped",
        notes: ["mission completed cleanly"],
      }),
    });

    // Tick 1: intake → planning
    const t1 = await runner.tick(missionId);
    expect(t1.transitioned).toBe(true);
    expect(t1.fromStatus).toBe("intake");
    expect(t1.toStatus).toBe("planning");

    // Tick 2: planning → executing (planner seeds two queued steps)
    const t2 = await runner.tick(missionId);
    expect(t2.transitioned).toBe(true);
    expect(t2.fromStatus).toBe("planning");
    expect(t2.toStatus).toBe("executing");
    expect(t2.stepsQueued).toBe(2);

    // Without progress, no further transition possible.
    const stuck = await runner.tick(missionId);
    expect(stuck.transitioned).toBe(false);
    expect(stuck.fromStatus).toBe("executing");

    // Mark all steps done — simulating executors finishing.
    await runner.markStepsDone(missionId);

    // Tick 3: executing → reflecting
    const t3 = await runner.tick(missionId);
    expect(t3.transitioned).toBe(true);
    expect(t3.fromStatus).toBe("executing");
    expect(t3.toStatus).toBe("reflecting");
    expect(t3.stepsDone).toBe(2);

    // Tick 4: reflecting → done (reflector signals done)
    const t4 = await runner.tick(missionId);
    expect(t4.transitioned).toBe(true);
    expect(t4.fromStatus).toBe("reflecting");
    expect(t4.toStatus).toBe("done");

    // Verify persistence.
    const mRow = (await db.select().from(missions).where(eq(missions.id, missionId)).limit(1))[0]!;
    expect(mRow.status).toBe("done");
    expect(mRow.finishedOutcome).toBe("shipped");
    expect(mRow.finishedAt).not.toBeNull();

    const transitions = await db
      .select()
      .from(missionStateTransitions)
      .where(eq(missionStateTransitions.missionId, missionId));
    expect(transitions).toHaveLength(4);
    const pairs = transitions.map((t) => `${t.fromStatus}->${t.toStatus}`).sort();
    expect(pairs).toEqual(
      ["intake->planning", "planning->executing", "executing->reflecting", "reflecting->done"].sort(),
    );

    const reflections = await db
      .select()
      .from(missionReflections)
      .where(eq(missionReflections.missionId, missionId));
    expect(reflections).toHaveLength(1);
    expect(reflections[0]!.body).toContain("mission completed cleanly");

    // Brain insight written when mission finished.
    const brainDoc = await brain.getBrain(wsId);
    expect(brainDoc.body).toContain("mission.done");
    expect(brainDoc.body).toContain("Build login");

    // A subsequent tick on a terminal mission is a no-op.
    const tDone = await runner.tick(missionId);
    expect(tDone.transitioned).toBe(false);
    expect(tDone.reason).toBe("terminal");
  });

  it("blocks executing → blocked when a step fails", async () => {
    const wsId = await seedWorkspace();
    const missionId = await seedMission(wsId);
    const runner = new MissionRunner({
      db,
      brain,
      planner: async () => ({
        steps: [{ kind: "code", title: "fragile step" }],
      }),
    });

    await runner.tick(missionId); // intake → planning
    await runner.tick(missionId); // planning → executing
    // Mark the step failed.
    await db
      .update(missionSteps)
      .set({ status: "failed", error: "boom" })
      .where(eq(missionSteps.missionId, missionId));

    const t = await runner.tick(missionId);
    expect(t.transitioned).toBe(true);
    expect(t.toStatus).toBe("blocked");
    expect(t.stepsFailed).toBe(1);

    // Runner cannot lift block — only the user.
    const stuck = await runner.tick(missionId);
    expect(stuck.transitioned).toBe(false);

    const userTick = await runner.tick(missionId, "user");
    expect(userTick.transitioned).toBe(true);
    expect(userTick.toStatus).toBe("planning");
  });

  it("reflecting → planning when reflector requests replan", async () => {
    const wsId = await seedWorkspace();
    const missionId = await seedMission(wsId);
    let phase = 0;
    const runner = new MissionRunner({
      db,
      brain,
      planner: async () => ({ steps: [{ kind: "code", title: "step" }] }),
      reflector: async () => {
        phase++;
        return phase === 1 ? { wantsReplan: true } : { wantsDone: true, finishedOutcome: "ok" };
      },
    });

    await runner.tick(missionId); // intake → planning
    await runner.tick(missionId); // planning → executing
    await runner.markStepsDone(missionId);
    const r1 = await runner.tick(missionId); // executing → reflecting
    expect(r1.toStatus).toBe("reflecting");
    const r2 = await runner.tick(missionId); // reflecting → planning (replan)
    expect(r2.toStatus).toBe("planning");

    const transitions = await db
      .select()
      .from(missionStateTransitions)
      .where(eq(missionStateTransitions.missionId, missionId));
    expect(transitions.some((t) => t.fromStatus === "reflecting" && t.toStatus === "planning")).toBe(
      true,
    );
  });
});
