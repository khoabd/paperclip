// Watchdog runner: builds WatchdogCtx for each active mission, evaluates rules,
// persists stuck_events, and applies suggested auto-actions through KillSwitch.
// Per Phase-6-Self-Healing-Extension §6.2 + §6.4.

import { and, eq, gte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  livenessHeartbeats,
  missions,
  stuckEvents,
} from "@paperclipai/db";
import { evaluateRules, type WatchdogCtx, type StuckEventDraft } from "./watchdog-rules.js";
import { KillSwitch, type KillLevel } from "./kill-switch.js";

export interface WatchdogRunReport {
  scanned: number;
  detected: number;
  stuckEventIds: string[];
  killEventIds: string[];
}

export interface WatchdogRunOptions {
  /** Override "now" for deterministic tests. */
  now?: Date;
  /** How many minutes of heartbeat history to inspect for the loop rule. Default 5. */
  toolCallLookbackMin?: number;
  /** Whether to apply auto-actions (kill, pause). Default true. */
  applyAutoActions?: boolean;
}

export class Watchdog {
  constructor(
    private readonly db: Db,
    private readonly killSwitch: KillSwitch,
  ) {}

  async runOnce(options: WatchdogRunOptions = {}): Promise<WatchdogRunReport> {
    const now = options.now ?? new Date();
    const lookbackMin = options.toolCallLookbackMin ?? 5;
    const apply = options.applyAutoActions ?? true;

    // Pull every mission currently in 'executing'. We diagnose only running work.
    const active = await this.db
      .select({
        id: missions.id,
        companyId: missions.companyId,
        status: missions.status,
        statePayload: missions.statePayload,
      })
      .from(missions)
      .where(eq(missions.status, "executing"));

    const stuckEventIds: string[] = [];
    const killEventIds: string[] = [];

    for (const mission of active) {
      const ctx = await this.buildCtx(mission, now, lookbackMin);
      const drafts = evaluateRules(ctx);
      for (const draft of drafts) {
        const id = await this.persistStuckEvent(mission, draft);
        stuckEventIds.push(id);
        if (apply && draft.suggestedAutoAction !== "observe_only") {
          const killId = await this.applyAutoAction(mission, draft);
          if (killId) killEventIds.push(killId);
        }
      }
    }

    return {
      scanned: active.length,
      detected: stuckEventIds.length,
      stuckEventIds,
      killEventIds,
    };
  }

  private async buildCtx(
    mission: { id: string; companyId: string; statePayload: unknown },
    now: Date,
    lookbackMin: number,
  ): Promise<WatchdogCtx> {
    const cutoff = new Date(now.getTime() - lookbackMin * 60_000);
    const recent = await this.db
      .select()
      .from(livenessHeartbeats)
      .where(
        and(
          eq(livenessHeartbeats.missionId, mission.id),
          gte(livenessHeartbeats.sentAt, cutoff),
        ),
      );

    let lastHeartbeatAt: Date | null = null;
    let lastState: string | null = null;
    let progressMarker: string | null = null;
    let costSoFar: number | null = null;
    let hasWaitingOnCycle = false;
    const recentToolCalls: string[] = [];

    for (const r of recent) {
      if (!lastHeartbeatAt || r.sentAt > lastHeartbeatAt) {
        lastHeartbeatAt = r.sentAt;
        lastState = r.state;
        progressMarker = r.progressMarker;
        costSoFar = r.costSoFarUsd != null ? Number(r.costSoFarUsd) : null;
      }
      if (r.currentTool) recentToolCalls.push(r.currentTool);
    }

    // Fall back to the absolute latest heartbeat (outside lookback) so stalled detection works.
    if (!lastHeartbeatAt) {
      const latest = (
        await this.db
          .select()
          .from(livenessHeartbeats)
          .where(eq(livenessHeartbeats.missionId, mission.id))
          .limit(1)
      )[0];
      if (latest) {
        lastHeartbeatAt = latest.sentAt;
        lastState = latest.state;
        progressMarker = latest.progressMarker;
        costSoFar = latest.costSoFarUsd != null ? Number(latest.costSoFarUsd) : null;
      } else {
        // No heartbeat ever — treat the mission as silent/active so stalled fires.
        lastHeartbeatAt = null;
        lastState = "active";
      }
    }

    // costRatio + waitingOn cycle detection are wired through state_payload hints
    // emitted by the strategic-loop runner. Phase 6 scaffolds these as nullable.
    const payload = (mission.statePayload as Record<string, unknown> | null) ?? {};
    const costRatio = typeof payload.costRatio === "number" ? payload.costRatio : null;
    const intakeVolumeRatio =
      typeof payload.intakeVolumeRatio === "number" ? payload.intakeVolumeRatio : null;
    if (typeof payload.waitingOnCycle === "boolean") {
      hasWaitingOnCycle = payload.waitingOnCycle;
    }
    const approvalQueueOverflow = !!payload.approvalQueueOverflow;

    return {
      missionId: mission.id,
      companyId: mission.companyId,
      lastHeartbeatAt,
      lastState,
      recentToolCalls,
      costRatio,
      costSoFarUsd: costSoFar,
      hasWaitingOnCycle,
      progressMarker,
      approvalQueueOverflow,
      intakeVolumeRatio,
      now,
    };
  }

  private async persistStuckEvent(
    mission: { id: string; companyId: string },
    draft: StuckEventDraft,
  ): Promise<string> {
    const inserted = (
      await this.db
        .insert(stuckEvents)
        .values({
          companyId: mission.companyId,
          missionId: mission.id,
          rule: draft.rule,
          diagnosis: draft.diagnosis,
          evidence: draft.evidence,
          autoAction: draft.suggestedAutoAction,
          autoActionResult: null,
        })
        .returning({ id: stuckEvents.id })
    )[0]!;
    return inserted.id;
  }

  private async applyAutoAction(
    mission: { id: string; companyId: string },
    draft: StuckEventDraft,
  ): Promise<string | null> {
    let level: KillLevel | null = null;
    let preserveCheckpoint = true;
    switch (draft.suggestedAutoAction) {
      case "kill_immediate":
      case "kill_cycle":
        level = "workflow";
        break;
      case "pause_and_snapshot":
        level = "workflow";
        preserveCheckpoint = true;
        break;
      case "ping_then_restart":
      case "restore_checkpoint":
      case "circuit_break":
      case "observe_only":
        level = null;
        break;
    }
    if (!level) return null;

    const result = await this.killSwitch.apply({
      level,
      targetId: mission.id,
      reason: `auto:${draft.rule}`,
      triggeredBy: `auto:${draft.rule}`,
      preserveCheckpoint,
      companyId: mission.companyId,
    });
    return result.killEventId;
  }
}
