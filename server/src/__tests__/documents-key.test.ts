import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb, documents } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping documents.key tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("documents.key (Phase 0 corrective — ADR-0007 brain storage)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-documents-key-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(documents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function createCompany() {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name: "TestCo",
      issuePrefix: `T${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return id;
  }

  it("allows multiple documents with NULL key per company", async () => {
    const companyId = await createCompany();
    await db.insert(documents).values([
      { companyId, latestBody: "first", key: null },
      { companyId, latestBody: "second", key: null },
      { companyId, latestBody: "third", key: null },
    ]);
    const rows = await db.select().from(documents);
    expect(rows).toHaveLength(3);
  });

  it("allows the same key in different companies", async () => {
    const companyA = await createCompany();
    const companyB = await createCompany();
    await db.insert(documents).values([
      { companyId: companyA, latestBody: "brain A", key: "brain" },
      { companyId: companyB, latestBody: "brain B", key: "brain" },
    ]);
    const rows = await db.select().from(documents);
    expect(rows).toHaveLength(2);
  });

  it("rejects duplicate key within the same company (ADR-0007 invariant)", async () => {
    const companyId = await createCompany();
    await db.insert(documents).values({
      companyId,
      latestBody: "first brain",
      key: "brain",
    });
    await expect(
      db.insert(documents).values({
        companyId,
        latestBody: "second brain",
        key: "brain",
      }),
    ).rejects.toThrow(/duplicate|unique/i);
  });

  it("supports brain sub-key namespace pattern (brain/personas, brain/principles, etc.)", async () => {
    const companyId = await createCompany();
    await db.insert(documents).values([
      { companyId, latestBody: "main brain", key: "brain" },
      { companyId, latestBody: "personas", key: "brain/personas" },
      { companyId, latestBody: "principles", key: "brain/principles" },
      { companyId, latestBody: "glossary", key: "brain/glossary" },
    ]);
    const rows = await db.select().from(documents);
    expect(rows).toHaveLength(4);
    const keys = rows.map((r) => r.key).sort();
    expect(keys).toEqual([
      "brain",
      "brain/glossary",
      "brain/personas",
      "brain/principles",
    ]);
  });
});
