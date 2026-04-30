// TC-CP-02: Mission spawn từ intake — bridge integrity.
// Verify FK consistency, idempotency, error path.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companies, createDb, intakeItems, missions } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { IntakeStore } from "../intake-store.js";
import { IntakeMissionBridge } from "../intake-mission-bridge.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping IntakeMissionBridge integration: ${support.reason ?? "unsupported"}`);
}

desc("IntakeMissionBridge integration — TC-CP-02", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let store!: IntakeStore;
  let bridge!: IntakeMissionBridge;
  let companyId!: string;
  let prefixCounter = 0;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("intake-bridge-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    store = new IntakeStore(db);
    bridge = new IntakeMissionBridge(db, store);
  });

  afterEach(async () => {
    await db.delete(missions);
    await db.delete(intakeItems);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedCompany(): Promise<string> {
    const id = randomUUID();
    prefixCounter += 1;
    await db.insert(companies).values({
      id,
      name: `BridgeCo-${prefixCounter}`,
      issuePrefix: `IB${prefixCounter.toString().padStart(3, "0")}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("happy path: spawn creates mission with FK to intake", async () => {
    companyId = await seedCompany();
    const intakeId = await store.create({
      companyId,
      type: "feature_request",
      rawText: "Add dark mode toggle to settings page",
      title: "Dark mode",
      priority: "P1",
    });

    const result = await bridge.spawn({ intakeId });

    expect(result.intakeId).toBe(intakeId);
    expect(result.missionId).toBeDefined();

    // Mission FK consistency: same companyId
    const [mission] = await db.select().from(missions).where(eq(missions.id, result.missionId));
    expect(mission.companyId).toBe(companyId);
    expect(mission.title).toBe("Dark mode");
    expect(mission.goal).toContain("dark mode");
    expect(mission.status).toBe("intake");

    // Intake row updated with missionId
    const [intake] = await db.select().from(intakeItems).where(eq(intakeItems.id, intakeId));
    expect(intake.missionId).toBe(result.missionId);
  });

  it("idempotent: second spawn returns same missionId, no duplicate mission row", async () => {
    companyId = await seedCompany();
    const intakeId = await store.create({
      companyId,
      type: "feature_request",
      rawText: "x",
      title: "X",
      priority: "P2",
    });

    const r1 = await bridge.spawn({ intakeId });
    const r2 = await bridge.spawn({ intakeId });

    expect(r2.missionId).toBe(r1.missionId);
    const allMissions = await db.select().from(missions);
    expect(allMissions).toHaveLength(1);
  });

  it("uses override missionTitle and missionGoal when provided", async () => {
    companyId = await seedCompany();
    const intakeId = await store.create({
      companyId,
      type: "feature_request",
      rawText: "raw text",
      title: "Original",
      priority: "P1",
    });

    const result = await bridge.spawn({
      intakeId,
      missionTitle: "Custom Title",
      missionGoal: "Custom Goal",
    });

    const [mission] = await db.select().from(missions).where(eq(missions.id, result.missionId));
    expect(mission.title).toBe("Custom Title");
    expect(mission.goal).toBe("Custom Goal");
  });

  it("falls back to type-based title when intake.title is null", async () => {
    companyId = await seedCompany();
    const intakeId = await store.create({
      companyId,
      type: "bug_report",
      rawText: "Something broke",
      priority: "P0",
    });

    const result = await bridge.spawn({ intakeId });
    const [mission] = await db.select().from(missions).where(eq(missions.id, result.missionId));
    expect(mission.title).toBe("Intake bug_report");
  });

  it("throws when intake does not exist", async () => {
    await expect(bridge.spawn({ intakeId: randomUUID() })).rejects.toThrow(/intake not found/);
  });

  it("no orphan: failed spawn (invalid intake) does not create mission row", async () => {
    const before = (await db.select().from(missions)).length;
    await expect(bridge.spawn({ intakeId: randomUUID() })).rejects.toThrow();
    const after = (await db.select().from(missions)).length;
    expect(after).toBe(before);
  });
});
