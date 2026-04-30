// TC-CHAOS-02: MCP cascade — verify circuit breaker prevents stampede when an
// upstream MCP fails repeatedly across many probes from many missions.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companies, createDb, mcpServers } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../../__tests__/helpers/embedded-postgres.js";
import { MCPHealthProbe } from "../health-probe.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping MCP cascade chaos: ${support.reason ?? "unsupported"}`);
}

desc("MCP cascade — TC-CHAOS-02 (circuit breaker prevents stampede)", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let companyId!: string;
  let serverId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("mcp-cascade-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Cascade Co",
      status: "active",
      autonomyLevel: "supervised",
      issuePrefix: `CSC-${companyId.slice(0, 6)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterEach(async () => {
    await db.delete(mcpServers);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedServer() {
    serverId = randomUUID();
    await db.insert(mcpServers).values({
      id: serverId,
      companyId,
      name: "gitlab",
      kind: "gitlab",
      transport: "http+sse",
      endpoint: "http://gitlab.test/mcp",
      status: "enabled",
      configJson: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it("cascade: 5 simultaneous failed probes only invoke upstream until breaker opens, then short-circuit", async () => {
    await seedServer();
    let upstreamInvocations = 0;
    const probe = new MCPHealthProbe(db, async () => {
      upstreamInvocations++;
      return { ok: false, error: "ECONNREFUSED" };
    });

    // First three probes hit upstream (closed → open after 3 failures).
    for (let i = 0; i < 3; i++) {
      await probe.check({ companyId, serverId });
    }
    expect(upstreamInvocations).toBe(3);

    // Subsequent probes from cascading missions are short-circuited and never touch the failing upstream.
    const cascade = await Promise.all(
      Array.from({ length: 10 }, () => probe.check({ companyId, serverId })),
    );
    expect(cascade.every((r) => r.status === "circuit_open")).toBe(true);
    expect(upstreamInvocations).toBe(3); // no additional upstream calls
  });

  it("recovery: when upstream comes back, half-open probe closes circuit and persistent error clears", async () => {
    await seedServer();
    let nowMs = 1_000_000;
    let upstreamOk = false;
    const probe = new MCPHealthProbe(
      db,
      async () => (upstreamOk ? { ok: true } : { ok: false, error: "down" }),
      () => nowMs,
    );

    // Trip the breaker.
    await probe.check({ companyId, serverId });
    await probe.check({ companyId, serverId });
    await probe.check({ companyId, serverId });
    let [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, serverId));
    expect(row.lastHealthError).toBe("down");

    // Wait past circuit window and bring upstream back.
    nowMs += 60_001;
    upstreamOk = true;
    const recovered = await probe.check({ companyId, serverId });
    expect(recovered.status).toBe("healthy");

    [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, serverId));
    expect(row.lastHealthError).toBeNull();
  });

  it("escalation hint: persistent failure beyond circuit window keeps reporting circuit_open until an actual successful probe lands", async () => {
    await seedServer();
    let nowMs = 1_000_000;
    const probe = new MCPHealthProbe(
      db,
      async () => ({ ok: false, error: "still down" }),
      () => nowMs,
    );

    // Trip breaker.
    await probe.check({ companyId, serverId });
    await probe.check({ companyId, serverId });
    await probe.check({ companyId, serverId });

    // Pass the half-open window, but upstream is still failing — circuit re-opens after the failed retry.
    nowMs += 60_001;
    expect((await probe.check({ companyId, serverId })).status).toBe("broken"); // half-open retry fails (counts again)

    // After the retry counts as a fresh failure, two more failures within window will trip again.
    await probe.check({ companyId, serverId });
    expect((await probe.check({ companyId, serverId })).status).toBe("circuit_open");
  });
});
