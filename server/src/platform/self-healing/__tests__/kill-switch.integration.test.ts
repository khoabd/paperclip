import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  companies,
  createDb,
  killEvents,
  missionSteps,
  missions,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../../__tests__/helpers/embedded-postgres.js";
import { KillSwitch } from "../kill-switch.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping KillSwitch integration tests: ${embeddedPostgresSupport.reason ?? "unsupported"}`,
  );
}

describeEmbeddedPostgres("KillSwitch", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let ks!: KillSwitch;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("kill-switch-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    ks = new KillSwitch(db);
  });

  afterEach(async () => {
    await db.delete(killEvents);
    await db.delete(missionSteps);
    await db.delete(missions);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedWorkspace(): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name: "KSCo",
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

  async function seedMission(workspaceId: string, status = "executing"): Promise<string> {
    const id = randomUUID();
    await db.insert(missions).values({
      id,
      companyId: workspaceId,
      title: "M",
      goal: "G",
      status,
    });
    return id;
  }

  it("level=workflow blocks the target mission and writes one kill_event", async () => {
    const wsId = await seedWorkspace();
    const missionId = await seedMission(wsId);
    const result = await ks.apply({
      level: "workflow",
      targetId: missionId,
      reason: "user requested stop",
      triggeredBy: "user:1",
      companyId: wsId,
    });
    expect(result.killedCount).toBe(1);
    expect(result.affectedMissionIds).toEqual([missionId]);

    const m = (await db.select().from(missions).where(eq(missions.id, missionId)))[0]!;
    expect(m.status).toBe("blocked");
    expect(m.blockedReason).toBe("user requested stop");

    const events = await db.select().from(killEvents).where(eq(killEvents.companyId, wsId));
    expect(events).toHaveLength(1);
    expect(events[0]!.level).toBe("workflow");
    expect(events[0]!.affectedMissionIds).toContain(missionId);
  });

  it("level=workspace blocks all running missions and pauses the workspace", async () => {
    const wsId = await seedWorkspace();
    const a = await seedMission(wsId, "executing");
    const b = await seedMission(wsId, "executing");
    const done = await seedMission(wsId, "done");

    const r = await ks.apply({
      level: "workspace",
      targetId: wsId,
      reason: "incident",
      triggeredBy: "user:ops",
      companyId: wsId,
    });
    expect(r.killedCount).toBe(2);
    expect(new Set(r.affectedMissionIds)).toEqual(new Set([a, b]));

    const allMissions = await db.select().from(missions).where(eq(missions.companyId, wsId));
    const byId = new Map(allMissions.map((m) => [m.id, m]));
    expect(byId.get(a)!.status).toBe("blocked");
    expect(byId.get(b)!.status).toBe("blocked");
    expect(byId.get(done)!.status).toBe("done"); // terminal preserved

    const ws = (await db.select().from(companies).where(eq(companies.id, wsId)))[0]!;
    expect(ws.status).toBe("paused");
  });

  it("level=task marks the step failed without blocking the parent mission", async () => {
    const wsId = await seedWorkspace();
    const missionId = await seedMission(wsId);
    const stepId = randomUUID();
    await db.insert(missionSteps).values({
      id: stepId,
      missionId,
      seq: 1,
      kind: "code",
      title: "broken step",
      status: "running",
    });

    const r = await ks.apply({
      level: "task",
      targetId: stepId,
      reason: "abandoned",
      triggeredBy: "user:1",
      companyId: wsId,
    });
    expect(r.killedCount).toBe(0);

    const step = (await db.select().from(missionSteps).where(eq(missionSteps.id, stepId)))[0]!;
    expect(step.status).toBe("failed");
    expect(step.error).toBe("abandoned");

    const m = (await db.select().from(missions).where(eq(missions.id, missionId)))[0]!;
    expect(m.status).toBe("executing");

    const ev = (await db.select().from(killEvents).where(eq(killEvents.companyId, wsId)))[0]!;
    expect(ev.level).toBe("task");
  });

  it("workflow kill on already-blocked mission is a no-op for status but writes audit", async () => {
    const wsId = await seedWorkspace();
    const blocked = await seedMission(wsId, "blocked");
    const r = await ks.apply({
      level: "workflow",
      targetId: blocked,
      reason: "second click",
      triggeredBy: "user:1",
      companyId: wsId,
    });
    expect(r.killedCount).toBe(0);
    const events = await db.select().from(killEvents).where(eq(killEvents.companyId, wsId));
    expect(events).toHaveLength(1);
  });
});
