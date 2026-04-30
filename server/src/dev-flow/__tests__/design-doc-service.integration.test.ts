// Integration tests: DesignDocService create + revise + transition + brain insight.
// Per Phase-7-Development-Flow-Feature-Flags §7.4.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  companies,
  createDb,
  designDocRevisions,
  designDocs,
  documentRevisions,
  documents,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { BrainStore } from "../../platform/strategic-loop/brain-store.js";
import { DesignDocService } from "../lifecycle/design-doc-service.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping DesignDocService integration tests: ${embeddedPostgresSupport.reason ?? "unsupported"}`,
  );
}

describeEmbeddedPostgres("DesignDocService", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let service!: DesignDocService;
  let brain!: BrainStore;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("design-doc-service-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    brain = new BrainStore(db);
    service = new DesignDocService(db, brain);
  });

  afterEach(async () => {
    await db.delete(designDocRevisions);
    await db.delete(designDocs);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  let prefixCounter = 0;

  async function seedWorkspace(): Promise<string> {
    const id = randomUUID();
    prefixCounter++;
    await db.insert(companies).values({
      id,
      name: `DocSvcCo${prefixCounter}`,
      status: "active",
      autonomyLevel: "sandbox",
      wfqWeight: 100,
      costBudgetUsdPerWeek: "100.0000",
      issuePrefix: `DS${prefixCounter}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("create writes a design_doc row + revision 1", async () => {
    const wsId = await seedWorkspace();
    const docId = await service.create({
      companyId: wsId,
      key: "my-feature",
      title: "My Feature Design",
      body: "## Overview\nThis is the design.",
      createdByUserId: "user-123",
    });

    const doc = await service.getById(wsId, docId);
    expect(doc).toBeDefined();
    expect(doc?.status).toBe("proposed");
    expect(doc?.key).toBe("my-feature");

    const revisions = await service.listRevisions(docId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.revisionNumber).toBe(1);
    expect(revisions[0]?.body).toBe("## Overview\nThis is the design.");
    expect(revisions[0]?.changeSummary).toBe("initial");
  });

  it("revise writes a new revision row and bumps revision number", async () => {
    const wsId = await seedWorkspace();
    const docId = await service.create({
      companyId: wsId,
      key: "revise-test",
      title: "Revise Test",
      body: "Version 1 body",
    });

    await service.revise({
      designDocId: docId,
      body: "Version 2 body",
      changeSummary: "Updated approach",
      createdByUserId: "user-456",
    });

    const revisions = await service.listRevisions(docId);
    expect(revisions).toHaveLength(2);
    expect(revisions[1]?.revisionNumber).toBe(2);
    expect(revisions[1]?.body).toBe("Version 2 body");
    expect(revisions[1]?.changeSummary).toBe("Updated approach");

    // Doc body updated.
    const doc = await service.getById(wsId, docId);
    expect(doc?.body).toBe("Version 2 body");
  });

  it("multiple revisions increment monotonically", async () => {
    const wsId = await seedWorkspace();
    const docId = await service.create({
      companyId: wsId,
      key: "multi-revise",
      title: "Multi Revise",
      body: "v1",
    });

    await service.revise({ designDocId: docId, body: "v2" });
    await service.revise({ designDocId: docId, body: "v3" });
    await service.revise({ designDocId: docId, body: "v4" });

    const revisions = await service.listRevisions(docId);
    expect(revisions).toHaveLength(4);
    expect(revisions.map((r) => r.revisionNumber)).toEqual([1, 2, 3, 4]);
  });

  it("transition proposed->review succeeds", async () => {
    const wsId = await seedWorkspace();
    const docId = await service.create({
      companyId: wsId,
      key: "transition-test",
      title: "Transition Test",
      body: "body",
    });

    const result = await service.transition({
      designDocId: docId,
      to: "review",
      actor: "runner",
      ctx: { noOpenConflicts: true, featureFlagLive: false },
      companyId: wsId,
    });

    expect(result.ok).toBe(true);
    const doc = await service.getById(wsId, docId);
    expect(doc?.status).toBe("review");
  });

  it("transition review->approved blocked when conflicts exist", async () => {
    const wsId = await seedWorkspace();
    const docId = await service.create({
      companyId: wsId,
      key: "blocked-test",
      title: "Blocked Test",
      body: "body",
    });

    // Move to review first.
    await service.transition({
      designDocId: docId,
      to: "review",
      actor: "runner",
      ctx: { noOpenConflicts: true, featureFlagLive: false },
      companyId: wsId,
    });

    const result = await service.transition({
      designDocId: docId,
      to: "approved",
      actor: "runner",
      ctx: { noOpenConflicts: false, featureFlagLive: false },
      companyId: wsId,
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/conflict/i);
  });

  it("transition to live appends brain insight kind=design.live", async () => {
    const wsId = await seedWorkspace();
    const docId = await service.create({
      companyId: wsId,
      key: "live-test",
      title: "Live Feature",
      body: "body",
    });

    // Walk through the full happy path.
    await service.transition({ designDocId: docId, to: "review", actor: "runner", ctx: { noOpenConflicts: true, featureFlagLive: false }, companyId: wsId });
    await service.transition({ designDocId: docId, to: "approved", actor: "runner", ctx: { noOpenConflicts: true, featureFlagLive: false }, companyId: wsId });
    await service.transition({ designDocId: docId, to: "in_dev", actor: "runner", ctx: { noOpenConflicts: true, featureFlagLive: false }, companyId: wsId });
    const result = await service.transition({ designDocId: docId, to: "live", actor: "runner", ctx: { noOpenConflicts: true, featureFlagLive: true }, companyId: wsId });

    expect(result.ok).toBe(true);

    // Brain document should contain the insight.
    const brainDoc = await brain.getBrain(wsId);
    expect(brainDoc.body).toContain("design.live");
    expect(brainDoc.body).toContain("Live Feature");
  });

  it("getById returns undefined for unknown doc", async () => {
    const wsId = await seedWorkspace();
    const doc = await service.getById(wsId, randomUUID());
    expect(doc).toBeUndefined();
  });

  it("transition returns not-found error for unknown doc", async () => {
    const wsId = await seedWorkspace();
    const result = await service.transition({
      designDocId: randomUUID(),
      to: "review",
      actor: "runner",
      ctx: { noOpenConflicts: true, featureFlagLive: false },
      companyId: wsId,
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/not found/i);
  });

  it("user can force-archive from any status", async () => {
    const wsId = await seedWorkspace();
    const docId = await service.create({
      companyId: wsId,
      key: "force-archive",
      title: "Force Archive",
      body: "body",
    });

    // Still in proposed; user force-archives.
    const result = await service.transition({
      designDocId: docId,
      to: "archived",
      actor: "user",
      ctx: { noOpenConflicts: true, featureFlagLive: false },
      companyId: wsId,
    });

    expect(result.ok).toBe(true);
    const doc = await service.getById(wsId, docId);
    expect(doc?.status).toBe("archived");
  });
});
