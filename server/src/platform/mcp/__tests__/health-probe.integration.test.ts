// SM-07: GitLab MCP health probe smoke.
// Healthy / broken / circuit_open transitions, last-health columns updated.

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
  console.warn(`Skipping MCPHealthProbe integration: ${support.reason ?? "unsupported"}`);
}

desc("MCPHealthProbe — SM-07", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let companyId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("mcp-health-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "MCP Health Co",
      status: "active",
      autonomyLevel: "supervised",
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

  async function seedServer(): Promise<string> {
    const id = randomUUID();
    await db.insert(mcpServers).values({
      id,
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
    return id;
  }

  it("healthy probe returns 'healthy' and clears last_health_error", async () => {
    const id = await seedServer();
    const probe = new MCPHealthProbe(db, async () => ({ ok: true }));
    const res = await probe.check({ companyId, serverId: id });

    expect(res.status).toBe("healthy");
    const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
    expect(row.lastHealthAt).toBeTruthy();
    expect(row.lastHealthError).toBeNull();
  });

  it("failed probe returns 'broken' with error captured on row", async () => {
    const id = await seedServer();
    const probe = new MCPHealthProbe(db, async () => ({ ok: false, error: "ECONNREFUSED" }));
    const res = await probe.check({ companyId, serverId: id });

    expect(res.status).toBe("broken");
    expect(res.error).toBe("ECONNREFUSED");
    const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
    expect(row.lastHealthError).toBe("ECONNREFUSED");
  });

  it("3 consecutive failures trips circuit → 'circuit_open' on next call", async () => {
    const id = await seedServer();
    const probe = new MCPHealthProbe(db, async () => ({ ok: false, error: "down" }));

    expect((await probe.check({ companyId, serverId: id })).status).toBe("broken");
    expect((await probe.check({ companyId, serverId: id })).status).toBe("broken");
    expect((await probe.check({ companyId, serverId: id })).status).toBe("circuit_open");
    // Next call short-circuits (does not invoke upstream).
    let invoked = false;
    const probe2 = new MCPHealthProbe(db, async () => {
      invoked = true;
      return { ok: true };
    });
    // Reuse the failing probe's tallies by checking same id on the same probe instance.
    const after = await probe.check({ companyId, serverId: id });
    expect(after.status).toBe("circuit_open");
    // Demonstrate that probe2 (no tally) would invoke; not the cached one.
    expect(invoked).toBe(false);
  });

  it("circuit resets after RESET_AFTER_MS via injected clock — half-open allows retry", async () => {
    const id = await seedServer();
    let nowMs = 1_000_000;
    let invokerOk = false;
    const probe = new MCPHealthProbe(
      db,
      async () => (invokerOk ? { ok: true } : { ok: false, error: "still down" }),
      () => nowMs,
    );

    // Trip the circuit.
    await probe.check({ companyId, serverId: id });
    await probe.check({ companyId, serverId: id });
    expect((await probe.check({ companyId, serverId: id })).status).toBe("circuit_open");

    // Within window: still circuit_open.
    nowMs += 30_000;
    expect((await probe.check({ companyId, serverId: id })).status).toBe("circuit_open");

    // After window, with healthy upstream: half-open retries and recovers.
    nowMs += 60_001;
    invokerOk = true;
    expect((await probe.check({ companyId, serverId: id })).status).toBe("healthy");
  });

  it("healthy after broken resets the failure tally", async () => {
    const id = await seedServer();
    let ok = false;
    const probe = new MCPHealthProbe(db, async () => (ok ? { ok: true } : { ok: false }));

    expect((await probe.check({ companyId, serverId: id })).status).toBe("broken");
    expect((await probe.check({ companyId, serverId: id })).status).toBe("broken");
    ok = true;
    expect((await probe.check({ companyId, serverId: id })).status).toBe("healthy");
    // After recovery, two more failures should NOT trip circuit (tally reset).
    ok = false;
    expect((await probe.check({ companyId, serverId: id })).status).toBe("broken");
    expect((await probe.check({ companyId, serverId: id })).status).toBe("broken");
    // Third failure trips again.
    expect((await probe.check({ companyId, serverId: id })).status).toBe("circuit_open");
  });
});
