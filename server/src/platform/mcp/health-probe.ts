// MCP health probe per Phase-4-MCP §health-probe.
// Pings registered MCP servers via a transport-shaped invoker and persists status.
// Implements a small circuit breaker: 3 consecutive failures flip to "circuit_open"
// and the probe returns immediately without re-invoking the upstream.

import { eq } from "drizzle-orm";
import { mcpServers, type createDb } from "@paperclipai/db";

export type McpDb = ReturnType<typeof createDb>;

export type ProbeStatus = "healthy" | "broken" | "circuit_open";

export type ProbeResult = {
  serverId: string;
  status: ProbeStatus;
  latencyMs: number;
  error?: string;
};

export type Invoker = (server: { id: string; endpoint: string }) => Promise<{ ok: boolean; error?: string }>;

const FAILURE_THRESHOLD = 3;
const RESET_AFTER_MS = 60_000;

type Tally = { consecutiveFailures: number; openedAt?: number };

export class MCPHealthProbe {
  private readonly tallies = new Map<string, Tally>();

  constructor(
    private readonly db: McpDb,
    private readonly invoker: Invoker,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async check(opts: { companyId?: string; serverId: string }): Promise<ProbeResult> {
    const tally = this.tallies.get(opts.serverId) ?? { consecutiveFailures: 0 };

    if (tally.openedAt && this.now() - tally.openedAt < RESET_AFTER_MS) {
      return {
        serverId: opts.serverId,
        status: "circuit_open",
        latencyMs: 0,
        error: "circuit open after threshold breach",
      };
    }
    if (tally.openedAt && this.now() - tally.openedAt >= RESET_AFTER_MS) {
      // Half-open: clear circuit, retry once.
      tally.openedAt = undefined;
      tally.consecutiveFailures = 0;
    }

    const [server] = await this.db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, opts.serverId));
    if (!server) {
      return {
        serverId: opts.serverId,
        status: "broken",
        latencyMs: 0,
        error: "server not found",
      };
    }

    const start = this.now();
    let probe: { ok: boolean; error?: string };
    try {
      probe = await this.invoker({ id: server.id, endpoint: server.endpoint });
    } catch (err) {
      probe = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    const latencyMs = Math.max(0, this.now() - start);

    if (probe.ok) {
      tally.consecutiveFailures = 0;
      tally.openedAt = undefined;
      this.tallies.set(opts.serverId, tally);
      await this.db
        .update(mcpServers)
        .set({ lastHealthAt: new Date(), lastHealthError: null, updatedAt: new Date() })
        .where(eq(mcpServers.id, opts.serverId));
      return { serverId: opts.serverId, status: "healthy", latencyMs };
    }

    tally.consecutiveFailures += 1;
    const tripped = tally.consecutiveFailures >= FAILURE_THRESHOLD;
    if (tripped) tally.openedAt = this.now();
    this.tallies.set(opts.serverId, tally);

    await this.db
      .update(mcpServers)
      .set({
        lastHealthAt: new Date(),
        lastHealthError: probe.error ?? "probe failed",
        updatedAt: new Date(),
      })
      .where(eq(mcpServers.id, opts.serverId));

    return {
      serverId: opts.serverId,
      status: tripped ? "circuit_open" : "broken",
      latencyMs,
      error: probe.error,
    };
  }

  resetCircuit(serverId: string): void {
    this.tallies.delete(serverId);
  }
}
