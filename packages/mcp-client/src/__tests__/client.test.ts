import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  McpClient,
  CircuitBreakerOpenError,
  InMemoryInvocationRecorder,
  type McpServerRegistration,
} from "../index.js";

function fakeRegistration(overrides: Partial<McpServerRegistration> = {}): McpServerRegistration {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    companyId: "00000000-0000-0000-0000-000000000001",
    name: "fake",
    kind: "custom",
    transport: "in-memory",
    endpoint: "memory://fake",
    authToken: null,
    status: "enabled",
    config: {},
    ...overrides,
  };
}

interface ServerHooks {
  setEcho(handler: (input: string) => string | Promise<string>): void;
  setSecret(handler: (input: { token: string }) => string | Promise<string>): void;
  setFlaky(handler: (input: { ok: boolean }) => string | Promise<string>): void;
  close: () => Promise<void>;
}

async function startInMemoryServer(): Promise<{ transport: InMemoryTransport; hooks: ServerHooks }> {
  const server = new McpServer({ name: "test-server", version: "0.0.1" });

  let echoHandler: (input: string) => string | Promise<string> = (s) => s;
  let secretHandler: (input: { token: string }) => string | Promise<string> = ({ token }) =>
    `received:${token}`;
  let flakyHandler: (input: { ok: boolean }) => string | Promise<string> = ({ ok }) => {
    if (!ok) throw new Error("flaky failure");
    return "flaky-ok";
  };

  server.tool("echo", { text: z.string() }, async ({ text }) => ({
    content: [{ type: "text", text: await echoHandler(text) }],
  }));
  server.tool("secret", { token: z.string() }, async ({ token }) => ({
    content: [{ type: "text", text: await secretHandler({ token }) }],
  }));
  server.tool("flaky", { ok: z.boolean() }, async ({ ok }) => ({
    content: [{ type: "text", text: await flakyHandler({ ok }) }],
  }));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  return {
    transport: clientTransport,
    hooks: {
      setEcho: (fn) => {
        echoHandler = fn;
      },
      setSecret: (fn) => {
        secretHandler = fn;
      },
      setFlaky: (fn) => {
        flakyHandler = fn;
      },
      close: async () => {
        await server.close();
      },
    },
  };
}

describe("McpClient (InMemoryTransport)", () => {
  let client: McpClient;
  let hooks: ServerHooks;
  let recorder: InMemoryInvocationRecorder;

  beforeEach(async () => {
    const started = await startInMemoryServer();
    hooks = started.hooks;
    recorder = new InMemoryInvocationRecorder();
    client = new McpClient({
      registration: fakeRegistration(),
      transportFactory: () => started.transport,
      recorder,
      retryPolicy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
      breakerOptions: { failureThreshold: 2, resetAfterMs: 50 },
      sleep: () => Promise.resolve(),
    });
  });

  afterEach(async () => {
    await client.close();
    await hooks.close();
  });

  it("connects, lists tools, and reports healthy", async () => {
    const health = await client.health();
    expect(health.ok).toBe(true);
    if (health.ok) expect(health.tools).toBeGreaterThanOrEqual(3);
  });

  it("calls a tool and records invocation", async () => {
    const result = await client.callTool("echo", { text: "ping" });
    expect(result.ok).toBe(true);
    expect(recorder.records).toHaveLength(1);
    const rec = recorder.records[0]!;
    expect(rec.toolName).toBe("echo");
    expect(rec.responseSummary.ok).toBe(true);
    expect(rec.error).toBeNull();
    expect(rec.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("redacts secret-like fields in the recorded request", async () => {
    await client.callTool("secret", { token: "supersecret" });
    expect(recorder.records).toHaveLength(1);
    const req = recorder.records[0]!.request as Record<string, unknown>;
    expect(req.token).toBe("[redacted]");
  });

  it("retries transient failures and eventually succeeds", async () => {
    let attempts = 0;
    hooks.setFlaky(({ ok }) => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient");
      return "ok-after-retry";
    });
    const result = await client.callTool("flaky", { ok: true });
    expect(result.ok).toBe(true);
    expect(attempts).toBe(3);
    expect(recorder.records).toHaveLength(1);
    expect(recorder.records[0]!.error).toBeNull();
  });

  it("opens the circuit breaker after consecutive failures", async () => {
    hooks.setFlaky(() => {
      throw new Error("always fails");
    });

    const r1 = await client.callTool("flaky", { ok: false });
    expect(r1.ok).toBe(false);
    const r2 = await client.callTool("flaky", { ok: false });
    expect(r2.ok).toBe(false);

    await expect(client.callTool("flaky", { ok: false })).rejects.toBeInstanceOf(
      CircuitBreakerOpenError,
    );
  });

  it("records error details on terminal failure", async () => {
    hooks.setFlaky(() => {
      throw new Error("boom");
    });
    const result = await client.callTool("flaky", { ok: false });
    expect(result.ok).toBe(false);
    const last = recorder.records[recorder.records.length - 1]!;
    expect(last.error).toMatch(/boom/);
    expect(last.responseSummary.ok).toBe(false);
  });
});
