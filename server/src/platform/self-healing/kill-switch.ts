// Kill switch with 5 levels — task | workflow | agent | workspace | global.
// Each invocation writes one kill_events row + flips affected missions to blocked.
// Per Phase-6-Self-Healing-Extension §6.2.

import { and, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companies, killEvents, missionSteps, missions } from "@paperclipai/db";

export type KillLevel = "task" | "workflow" | "agent" | "workspace" | "global";

export interface KillInput {
  level: KillLevel;
  /** mission_step.id (task), missions.id (workflow), agents.id (agent), companies.id (workspace), or "*" (global). */
  targetId: string;
  /** Required for audit. May be `auto:<rule>` for watchdog-driven kills. */
  reason: string;
  triggeredBy: string;
  preserveCheckpoint?: boolean;
  refundUsd?: number | null;
  companyId?: string | null;
}

export interface KillResult {
  killEventId: string;
  killedCount: number;
  affectedMissionIds: string[];
}

const TERMINAL_MISSION_STATUSES = ["done", "blocked"];

export class KillSwitch {
  constructor(private readonly db: Db) {}

  async apply(input: KillInput): Promise<KillResult> {
    const affected = await this.collectAffectedMissions(input);

    if (affected.length > 0) {
      await this.db
        .update(missions)
        .set({
          status: "blocked",
          blockedReason: input.reason,
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(missions.id, affected),
            ne(missions.status, "done"),
            ne(missions.status, "blocked"),
          ),
        );
    }

    if (input.level === "task") {
      await this.db
        .update(missionSteps)
        .set({ status: "failed", error: input.reason, finishedAt: new Date() })
        .where(eq(missionSteps.id, input.targetId));
    }

    if (input.level === "workspace" && input.companyId) {
      await this.db
        .update(companies)
        .set({ status: "paused", updatedAt: new Date() })
        .where(eq(companies.id, input.companyId));
    }

    const inserted = (
      await this.db
        .insert(killEvents)
        .values({
          companyId: input.companyId ?? null,
          level: input.level,
          targetId: input.targetId,
          triggeredBy: input.triggeredBy,
          reason: input.reason,
          preserveCheckpoint: input.preserveCheckpoint ?? true,
          killedCount: affected.length,
          refundUsd: input.refundUsd != null ? input.refundUsd.toString() : null,
          affectedMissionIds: affected,
        })
        .returning({ id: killEvents.id })
    )[0]!;

    return {
      killEventId: inserted.id,
      killedCount: affected.length,
      affectedMissionIds: affected,
    };
  }

  private async collectAffectedMissions(input: KillInput): Promise<string[]> {
    if (input.level === "task") {
      const step = (
        await this.db
          .select({ missionId: missionSteps.missionId })
          .from(missionSteps)
          .where(eq(missionSteps.id, input.targetId))
          .limit(1)
      )[0];
      // Task-level kill does not block the parent mission; the runner picks the next step.
      return step ? [] : [];
    }
    if (input.level === "workflow") {
      const m = (
        await this.db
          .select({ id: missions.id, status: missions.status })
          .from(missions)
          .where(eq(missions.id, input.targetId))
          .limit(1)
      )[0];
      if (!m || TERMINAL_MISSION_STATUSES.includes(m.status as string)) return [];
      return [m.id];
    }
    if (input.level === "workspace") {
      const rows = await this.db
        .select({ id: missions.id, status: missions.status })
        .from(missions)
        .where(eq(missions.companyId, input.targetId));
      return rows.filter((r) => !TERMINAL_MISSION_STATUSES.includes(r.status as string)).map((r) => r.id);
    }
    if (input.level === "agent") {
      // Phase 6 doesn't track per-agent mission ownership in the missions table directly;
      // the strategic-loop emits agent_id into liveness_heartbeats. For now we no-op the cascade
      // and rely on the audit row + downstream Phase 7 wiring.
      return [];
    }
    // global
    const rows = await this.db
      .select({ id: missions.id, status: missions.status })
      .from(missions);
    return rows.filter((r) => !TERMINAL_MISSION_STATUSES.includes(r.status as string)).map((r) => r.id);
  }
}
