import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  companies,
  createDb,
  entityEmbeddings,
  mcpServers,
  mcpToolInvocations,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping MCP schema tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("Phase 1 — MCP + entity_embeddings schema", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-mcp-schema-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(mcpToolInvocations);
    await db.delete(mcpServers);
    await db.delete(entityEmbeddings);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function createCompany() {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name: "MCPCo",
      issuePrefix: `M${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return id;
  }

  it("registers an mcp_servers row with platform-default (NULL company_id) and per-company variants", async () => {
    const companyId = await createCompany();

    await db.insert(mcpServers).values([
      {
        companyId: null,
        name: "platform-gitlab",
        kind: "gitlab",
        endpoint: "https://gitlab.example",
      },
      {
        companyId,
        name: "company-gitlab",
        kind: "gitlab",
        endpoint: "https://gitlab.example/company",
      },
      {
        companyId,
        name: "company-opensearch",
        kind: "opensearch",
        endpoint: "https://opensearch.example",
      },
    ]);

    const all = await db.select().from(mcpServers);
    expect(all).toHaveLength(3);
    const platformOnly = all.find((r) => r.companyId === null);
    expect(platformOnly?.name).toBe("platform-gitlab");
    expect(platformOnly?.transport).toBe("http+sse");
    expect(platformOnly?.status).toBe("enabled");
  });

  it("records mcp_tool_invocations rows with redacted request payloads", async () => {
    const companyId = await createCompany();

    const [server] = await db
      .insert(mcpServers)
      .values({ companyId, name: "audit-target", kind: "gitlab", endpoint: "https://gl/" })
      .returning();
    expect(server).toBeDefined();

    await db.insert(mcpToolInvocations).values([
      {
        mcpServerId: server!.id,
        companyId,
        toolName: "gitlab.createBranch",
        requestJson: { projectId: "demo", branch: "feature/x", token: "[redacted]" },
        responseSummary: { ok: true, status: "ok", byteSize: 42 },
        durationMs: 12,
      },
      {
        mcpServerId: server!.id,
        companyId,
        toolName: "gitlab.openMergeRequest",
        requestJson: { projectId: "demo", title: "feat: x" },
        responseSummary: { ok: false, status: "error" },
        durationMs: 88,
        error: "rate limit",
      },
    ]);

    const rows = await db.select().from(mcpToolInvocations);
    expect(rows).toHaveLength(2);
    const create = rows.find((r) => r.toolName === "gitlab.createBranch");
    expect((create?.requestJson as Record<string, unknown>).token).toBe("[redacted]");
    const failure = rows.find((r) => r.toolName === "gitlab.openMergeRequest");
    expect(failure?.error).toBe("rate limit");
  });

  it("supports entity_embeddings round-trip with multiple entity types", async () => {
    const companyId = await createCompany();
    const docId = randomUUID();
    const issueId = randomUUID();
    const dim = 8;
    const vec = (seed: number) => Array.from({ length: dim }, (_, i) => Math.sin(seed + i));

    await db.insert(entityEmbeddings).values([
      {
        companyId,
        entityType: "document",
        entityId: docId,
        chunkIndex: 0,
        chunkText: "doc chunk 0",
        embedding: vec(1),
      },
      {
        companyId,
        entityType: "document",
        entityId: docId,
        chunkIndex: 1,
        chunkText: "doc chunk 1",
        embedding: vec(2),
      },
      {
        companyId,
        entityType: "issue",
        entityId: issueId,
        chunkText: "issue summary",
        embedding: vec(3),
      },
    ]);

    const docs = await db
      .select()
      .from(entityEmbeddings)
      .where(sql`${entityEmbeddings.entityType} = 'document'`);
    expect(docs).toHaveLength(2);
    expect(docs[0]!.embedding).toHaveLength(dim);
    expect(docs[0]!.model).toBe("text-embedding-3-small");

    const issues = await db
      .select()
      .from(entityEmbeddings)
      .where(sql`${entityEmbeddings.entityType} = 'issue'`);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.chunkText).toBe("issue summary");
  });

  it("cascades mcp_tool_invocations when its mcp_servers parent is deleted", async () => {
    const companyId = await createCompany();
    const [server] = await db
      .insert(mcpServers)
      .values({ companyId, name: "cascade", kind: "gitlab", endpoint: "https://gl/" })
      .returning();
    await db.insert(mcpToolInvocations).values({
      mcpServerId: server!.id,
      companyId,
      toolName: "gitlab.listFiles",
      durationMs: 5,
    });
    expect(await db.select().from(mcpToolInvocations)).toHaveLength(1);
    await db.delete(mcpServers).where(sql`${mcpServers.id} = ${server!.id}`);
    expect(await db.select().from(mcpToolInvocations)).toHaveLength(0);
  });
});
