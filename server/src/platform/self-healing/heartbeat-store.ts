// Heartbeat read/write helpers for the self-healing layer.
// Per Phase-6-Self-Healing-Extension §6.2.

import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { livenessHeartbeats } from "@paperclipai/db";

export type HeartbeatState = "active" | "completed" | "killed" | "errored" | "paused";

export interface PublishHeartbeat {
  missionId: string;
  missionStepId?: string | null;
  agentId?: string | null;
  state: HeartbeatState;
  progressMarker?: string | null;
  costSoFarUsd?: number | null;
  tokensSoFar?: number | null;
  currentTool?: string | null;
  waitingOn?: string | null;
}

export interface HeartbeatRow {
  id: string;
  missionId: string;
  missionStepId: string | null;
  agentId: string | null;
  state: HeartbeatState;
  progressMarker: string | null;
  costSoFarUsd: number | null;
  tokensSoFar: number | null;
  currentTool: string | null;
  waitingOn: string | null;
  sentAt: Date;
}

export class HeartbeatStore {
  constructor(private readonly db: Db) {}

  async publish(input: PublishHeartbeat): Promise<string> {
    const inserted = (
      await this.db
        .insert(livenessHeartbeats)
        .values({
          missionId: input.missionId,
          missionStepId: input.missionStepId ?? null,
          agentId: input.agentId ?? null,
          state: input.state,
          progressMarker: input.progressMarker ?? null,
          costSoFarUsd: input.costSoFarUsd != null ? input.costSoFarUsd.toString() : null,
          tokensSoFar: input.tokensSoFar ?? null,
          currentTool: input.currentTool ?? null,
          waitingOn: input.waitingOn ?? null,
        })
        .returning({ id: livenessHeartbeats.id })
    )[0]!;
    return inserted.id;
  }

  async latest(missionId: string): Promise<HeartbeatRow | null> {
    const row = (
      await this.db
        .select()
        .from(livenessHeartbeats)
        .where(eq(livenessHeartbeats.missionId, missionId))
        .orderBy(desc(livenessHeartbeats.sentAt))
        .limit(1)
    )[0];
    return row ? toRow(row) : null;
  }

  async recent(missionId: string, sinceMin: number): Promise<HeartbeatRow[]> {
    const cutoff = new Date(Date.now() - sinceMin * 60_000);
    const rows = await this.db
      .select()
      .from(livenessHeartbeats)
      .where(
        and(
          eq(livenessHeartbeats.missionId, missionId),
          gte(livenessHeartbeats.sentAt, cutoff),
        ),
      )
      .orderBy(asc(livenessHeartbeats.sentAt));
    return rows.map(toRow);
  }

  /**
   * Returns the last heartbeat for each active mission whose newest heartbeat
   * is older than `staleAfterMin`. Used by the watchdog stalled rule.
   */
  async activeButQuietFor(staleAfterMin: number): Promise<HeartbeatRow[]> {
    const cutoff = new Date(Date.now() - staleAfterMin * 60_000);
    // Latest-per-mission via DISTINCT ON ordered by sent_at desc.
    const rows = await this.db.execute(sql`
      SELECT DISTINCT ON (mission_id)
        id, mission_id, mission_step_id, agent_id, state, progress_marker,
        cost_so_far_usd, tokens_so_far, current_tool, waiting_on, sent_at
      FROM ${livenessHeartbeats}
      ORDER BY mission_id, sent_at DESC
    `);
    const list = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []) as Array<
      Record<string, unknown>
    >;
    return list
      .map((r) => ({
        id: String(r.id),
        missionId: String(r.mission_id),
        missionStepId: r.mission_step_id == null ? null : String(r.mission_step_id),
        agentId: r.agent_id == null ? null : String(r.agent_id),
        state: String(r.state) as HeartbeatState,
        progressMarker: r.progress_marker == null ? null : String(r.progress_marker),
        costSoFarUsd: r.cost_so_far_usd == null ? null : Number(r.cost_so_far_usd),
        tokensSoFar: r.tokens_so_far == null ? null : Number(r.tokens_so_far),
        currentTool: r.current_tool == null ? null : String(r.current_tool),
        waitingOn: r.waiting_on == null ? null : String(r.waiting_on),
        sentAt: new Date(r.sent_at as string),
      }))
      .filter((r) => r.state === "active" && r.sentAt <= cutoff);
  }
}

function toRow(row: typeof livenessHeartbeats.$inferSelect): HeartbeatRow {
  return {
    id: row.id,
    missionId: row.missionId,
    missionStepId: row.missionStepId,
    agentId: row.agentId,
    state: row.state as HeartbeatState,
    progressMarker: row.progressMarker,
    costSoFarUsd: row.costSoFarUsd != null ? Number(row.costSoFarUsd) : null,
    tokensSoFar: row.tokensSoFar,
    currentTool: row.currentTool,
    waitingOn: row.waitingOn,
    sentAt: row.sentAt,
  };
}
