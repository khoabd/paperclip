// TC-INT-MCP-RECORDER-01: MCP InvocationRecorder + redaction.
// Verifies every MCP tool call is persisted with secrets redacted in both request
// and response payloads, status tracked, and latency recorded.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companies, createDb, mcpServers, mcpToolInvocations } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../../__tests__/helpers/embedded-postgres.js";
import { InvocationRecorder, redactJson } from "../invocation-recorder.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping InvocationRecorder integration: ${support.reason ?? "unsupported"}`);
}

desc("InvocationRecorder — TC-INT-MCP-RECORDER-01", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let companyId!: string;
  let mcpServerId!: string;
  let recorder!: InvocationRecorder;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("mcp-recorder-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    recorder = new InvocationRecorder(db);

    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "MCP Recorder Co",
      status: "active",
      autonomyLevel: "supervised",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mcpServerId = randomUUID();
    await db.insert(mcpServers).values({
      id: mcpServerId,
      companyId,
      name: "test-gitlab",
      kind: "gitlab",
      transport: "http+sse",
      endpoint: "http://localhost:0/mock",
      status: "enabled",
      configJson: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterEach(async () => {
    await db.delete(mcpToolInvocations);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  describe("redactJson — pure function", () => {
    it("redacts canonical secret-bearing keys", () => {
      const out = redactJson({
        token: "secret-abc",
        api_key: "sk-12345",
        apiKey: "sk-67890",
        password: "hunter2",
        bearer: "abc",
        authorization: "Bearer xyz",
        credential: "raw",
        branch: "feature/test",
      }) as Record<string, string>;

      expect(out.token).toBe("[REDACTED]");
      expect(out.api_key).toBe("[REDACTED]");
      expect(out.apiKey).toBe("[REDACTED]");
      expect(out.password).toBe("[REDACTED]");
      expect(out.bearer).toBe("[REDACTED]");
      expect(out.authorization).toBe("[REDACTED]");
      expect(out.credential).toBe("[REDACTED]");
      expect(out.branch).toBe("feature/test");
    });

    it("redacts nested objects + arrays recursively", () => {
      const out = redactJson({
        outer: {
          token: "x",
          arr: [{ secret: "y", name: "ok" }, { value: "fine" }],
        },
      }) as { outer: { token: string; arr: Array<Record<string, string>> } };
      expect(out.outer.token).toBe("[REDACTED]");
      expect(out.outer.arr[0].secret).toBe("[REDACTED]");
      expect(out.outer.arr[0].name).toBe("ok");
      expect(out.outer.arr[1].value).toBe("fine");
    });

    it("redacts secret-pattern strings inside otherwise-safe fields (Bearer, sk-..., AKIA...)", () => {
      const out = redactJson({
        message: "Got Bearer abc.def.ghi back from server",
        config: "key=sk-1234567890abcdefghij",
        aws: "AKIAIOSFODNN7EXAMPLE in env",
      }) as Record<string, string>;
      expect(out.message).toContain("[REDACTED]");
      expect(out.message).not.toContain("Bearer abc.def.ghi");
      expect(out.config).toContain("[REDACTED]");
      expect(out.config).not.toContain("sk-1234567890abcdefghij");
      expect(out.aws).toContain("[REDACTED]");
    });
  });

  it("record(): persists row with token redacted, branch preserved", async () => {
    const result = await recorder.record({
      mcpServerId,
      companyId,
      toolName: "gitlab.create_branch",
      request: { token: "secret-abc", branch: "feature/test" },
      response: { ok: true, sha: "abc123" },
      durationMs: 142,
    });

    const [row] = await db
      .select()
      .from(mcpToolInvocations)
      .where(eq(mcpToolInvocations.id, result.id));

    const req = row.requestJson as Record<string, unknown>;
    expect(req.token).toBe("[REDACTED]");
    expect(req.branch).toBe("feature/test");
    expect(row.toolName).toBe("gitlab.create_branch");
    expect(row.durationMs).toBe(142);
    expect(row.error).toBeNull();
  });

  it("record(): redacts secret-key fields in response body too", async () => {
    const result = await recorder.record({
      mcpServerId,
      companyId,
      toolName: "auth.echo",
      request: { kind: "echo" },
      response: { ok: true, token: "leaked-xyz", message: "Bearer leaked-xyz" },
      durationMs: 5,
    });

    const [row] = await db
      .select()
      .from(mcpToolInvocations)
      .where(eq(mcpToolInvocations.id, result.id));

    const resp = row.responseSummary as Record<string, unknown>;
    expect(resp.token).toBe("[REDACTED]");
    expect(resp.message).toContain("[REDACTED]");
    expect(resp.message).not.toContain("leaked-xyz");
  });

  it("status=timeout: error column populated, latency tracked", async () => {
    const result = await recorder.record({
      mcpServerId,
      companyId,
      toolName: "slow.tool",
      request: { wait: 30000 },
      durationMs: 30001,
      status: "timeout",
    });

    const [row] = await db
      .select()
      .from(mcpToolInvocations)
      .where(eq(mcpToolInvocations.id, result.id));

    expect(result.status).toBe("timeout");
    expect(row.error).toBe("timeout");
    expect(row.durationMs).toBe(30001);
  });

  it("status=error: errorMessage redacted before persist (avoid stack leak)", async () => {
    const result = await recorder.record({
      mcpServerId,
      companyId,
      toolName: "broken.tool",
      request: { input: "x" },
      durationMs: 12,
      status: "error",
      errorMessage:
        "Failed to call API: bad header Bearer leaked.token.here at line 42",
    });

    const [row] = await db
      .select()
      .from(mcpToolInvocations)
      .where(eq(mcpToolInvocations.id, result.id));

    expect(result.status).toBe("error");
    expect(row.error).toContain("[REDACTED]");
    expect(row.error).not.toContain("leaked.token.here");
  });

  it("end-to-end: request + response + status all redacted, audit row complete", async () => {
    await recorder.record({
      mcpServerId,
      companyId,
      toolName: "gitlab.create_branch",
      request: { token: "secret-1", branch: "f1" },
      response: { ok: true, message: "no leak" },
      durationMs: 50,
    });
    await recorder.record({
      mcpServerId,
      companyId,
      toolName: "gitlab.create_mr",
      request: { api_key: "secret-2", title: "MR" },
      response: { ok: true, id: 99 },
      durationMs: 80,
    });

    const rows = await db
      .select()
      .from(mcpToolInvocations)
      .where(eq(mcpToolInvocations.companyId, companyId));

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const req = row.requestJson as Record<string, unknown>;
      // Confirm no obvious secret leaked through.
      const blob = JSON.stringify(req);
      expect(blob).not.toContain("secret-1");
      expect(blob).not.toContain("secret-2");
      expect(row.durationMs).toBeGreaterThan(0);
    }
  });
});
