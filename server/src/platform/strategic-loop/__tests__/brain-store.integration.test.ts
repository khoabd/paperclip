import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  companies,
  createDb,
  documents,
  documentRevisions,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../../__tests__/helpers/embedded-postgres.js";
import { BrainStore } from "../brain-store.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping BrainStore integration tests: ${embeddedPostgresSupport.reason ?? "unsupported"}`,
  );
}

describeEmbeddedPostgres("BrainStore", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let brain!: BrainStore;
  let workspaceId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("brain-store-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    brain = new BrainStore(db);
  });

  afterEach(async () => {
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
      name: "BrainCo",
      status: "active",
      autonomyLevel: "sandbox",
      wfqWeight: 100,
      costBudgetUsdPerWeek: "100.0000",
      ragNamespace: `ns-${id}`,
      vaultPath: `/vault/${id}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    workspaceId = id;
    return id;
  }

  it("creates the workspace brain on first read and round-trips", async () => {
    const id = await seedWorkspace();
    const first = await brain.getBrain(id);
    expect(first.body).toContain("# Workspace Brain");
    expect(first.body).toContain("## Insights");
    expect(first.body).toContain("## Notes");
    expect(first.revisionNumber).toBe(1);
    expect(first.revisionId).not.toBeNull();

    const second = await brain.getBrain(id);
    expect(second.documentId).toBe(first.documentId);
    expect(second.revisionNumber).toBe(1);

    const docRows = await db
      .select()
      .from(documents)
      .where(eq(documents.companyId, id));
    expect(docRows).toHaveLength(1);
    const revRows = await db
      .select()
      .from(documentRevisions)
      .where(eq(documentRevisions.documentId, first.documentId));
    expect(revRows).toHaveLength(1);
  });

  it("appendInsight bumps revision and adds a bullet under ## Insights", async () => {
    const id = await seedWorkspace();
    await brain.getBrain(id);
    const after = await brain.appendInsight({
      workspaceId: id,
      kind: "lesson",
      body: "always run typecheck before push",
    });
    expect(after.revisionNumber).toBe(2);
    expect(after.body).toContain("## Insights");
    expect(after.body).toContain("**lesson**");
    expect(after.body).toContain("always run typecheck before push");

    const revs = await db
      .select()
      .from(documentRevisions)
      .where(eq(documentRevisions.documentId, after.documentId));
    expect(revs).toHaveLength(2);
    const latest = revs.find((r) => r.revisionNumber === 2)!;
    expect(latest.changeSummary).toBe("insight:lesson");
  });

  it("getMissionBrain creates a separate namespaced doc", async () => {
    const id = await seedWorkspace();
    const missionId = randomUUID();
    const ws = await brain.getBrain(id);
    const m = await brain.getMissionBrain(id, missionId);
    expect(m.documentId).not.toBe(ws.documentId);
    expect(m.body).toContain(missionId);

    const all = await db
      .select()
      .from(documents)
      .where(eq(documents.companyId, id));
    expect(all).toHaveLength(2);
    const keys = all.map((d) => d.key).sort();
    expect(keys).toEqual(["brain", `brain/missions/${missionId}`].sort());
  });

  it("appendMissionNote writes under the mission brain only", async () => {
    const id = await seedWorkspace();
    const missionId = randomUUID();
    await brain.getBrain(id);
    const m = await brain.appendMissionNote({
      workspaceId: id,
      missionId,
      kind: "step",
      body: "shipped the planning doc",
    });
    expect(m.body).toContain("**step**");
    expect(m.body).toContain("shipped the planning doc");

    const ws = await brain.getBrain(id);
    expect(ws.body).not.toContain("shipped the planning doc");
  });
});
