import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
  livenessHeartbeats,
  missions,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../../__tests__/helpers/embedded-postgres.js";
import { HeartbeatStore } from "../heartbeat-store.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping HeartbeatStore integration tests: ${embeddedPostgresSupport.reason ?? "unsupported"}`,
  );
}

describeEmbeddedPostgres("HeartbeatStore", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let store!: HeartbeatStore;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("heartbeat-store-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    store = new HeartbeatStore(db);
  });

  afterEach(async () => {
    await db.delete(livenessHeartbeats);
    await db.delete(missions);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  let prefixCounter = 0;
  async function seed(): Promise<{ workspaceId: string; missionId: string }> {
    const workspaceId = randomUUID();
    prefixCounter += 1;
    await db.insert(companies).values({
      id: workspaceId,
      name: `HBCo${prefixCounter}`,
      status: "active",
      autonomyLevel: "sandbox",
      wfqWeight: 100,
      costBudgetUsdPerWeek: "100.0000",
      ragNamespace: `ns-${workspaceId}`,
      vaultPath: `/vault/${workspaceId}`,
      issuePrefix: `HB${prefixCounter}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const missionId = randomUUID();
    await db.insert(missions).values({
      id: missionId,
      companyId: workspaceId,
      title: "T",
      goal: "G",
      status: "executing",
    });
    return { workspaceId, missionId };
  }

  it("publish writes a row, latest returns most recent", async () => {
    const { missionId } = await seed();
    await store.publish({
      missionId,
      state: "active",
      progressMarker: "step-1",
      costSoFarUsd: 0.5,
    });
    await store.publish({
      missionId,
      state: "active",
      progressMarker: "step-2",
      costSoFarUsd: 1.25,
      tokensSoFar: 1234,
      currentTool: "git_diff",
    });
    const latest = await store.latest(missionId);
    expect(latest).not.toBeNull();
    expect(latest!.progressMarker).toBe("step-2");
    expect(latest!.tokensSoFar).toBe(1234);
    expect(latest!.costSoFarUsd).toBeCloseTo(1.25, 4);
  });

  it("recent returns ordered window", async () => {
    const { missionId } = await seed();
    await store.publish({ missionId, state: "active", currentTool: "a" });
    await store.publish({ missionId, state: "active", currentTool: "b" });
    const list = await store.recent(missionId, 60);
    expect(list.map((r) => r.currentTool)).toEqual(["a", "b"]);
  });

  it("activeButQuietFor surfaces stalled mission heartbeats", async () => {
    const { missionId: a } = await seed();
    const { missionId: b } = await seed();
    // a was active 10 min ago.
    await db.insert(livenessHeartbeats).values({
      missionId: a,
      state: "active",
      sentAt: new Date(Date.now() - 10 * 60_000),
    });
    // b was active 30s ago.
    await db.insert(livenessHeartbeats).values({
      missionId: b,
      state: "active",
      sentAt: new Date(Date.now() - 30_000),
    });
    const stale = await store.activeButQuietFor(5);
    const ids = stale.map((r) => r.missionId);
    expect(ids).toContain(a);
    expect(ids).not.toContain(b);
  });
});
