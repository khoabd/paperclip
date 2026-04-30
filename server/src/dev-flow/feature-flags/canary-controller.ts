// CanaryController: staged rollout 0→5→25→50→100 for feature flags.
// Each step appends to history JSONB and updates the parent feature_flags.rollout_percent.
// Per Phase-7-Development-Flow-Feature-Flags §7.2.

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { canaryRuns, featureFlags } from "@paperclipai/db";

export const CANARY_STAGES = [0, 5, 25, 50, 100] as const;
export type CanaryStage = (typeof CANARY_STAGES)[number];

export interface HistoryEntry {
  percent: number;
  at: string; // ISO timestamp
}

export class CanaryController {
  constructor(private readonly db: Db) {}

  /** Open a new canary run at 5% and update the parent flag. */
  async start(flagId: string): Promise<string> {
    const initialPercent = 5;
    const now = new Date();
    const entry: HistoryEntry = { percent: initialPercent, at: now.toISOString() };

    const [run] = await this.db
      .insert(canaryRuns)
      .values({
        featureFlagId: flagId,
        currentPercent: initialPercent,
        history: [entry],
        status: "running",
      })
      .returning({ id: canaryRuns.id });

    if (!run) throw new Error("insert canary_runs returned no row");

    await this.db
      .update(featureFlags)
      .set({ rolloutPercent: initialPercent, status: "canary", updatedAt: now })
      .where(eq(featureFlags.id, flagId));

    return run.id;
  }

  /** Ramp to a specific target percent (must be 25 | 50 | 100). */
  async step(canaryId: string, target: 25 | 50 | 100): Promise<void> {
    const [run] = await this.db
      .select()
      .from(canaryRuns)
      .where(eq(canaryRuns.id, canaryId))
      .limit(1);

    if (!run) throw new Error(`canary run ${canaryId} not found`);
    if (run.status !== "running") throw new Error(`canary run is ${run.status}, not running`);

    const now = new Date();
    const entry: HistoryEntry = { percent: target, at: now.toISOString() };
    const updatedHistory = [...(run.history as HistoryEntry[]), entry];

    const newStatus = target === 100 ? "completed" : "running";

    await this.db
      .update(canaryRuns)
      .set({
        currentPercent: target,
        history: updatedHistory,
        status: newStatus,
        ...(newStatus === "completed" ? { endedAt: now } : {}),
      })
      .where(eq(canaryRuns.id, canaryId));

    // Sync rollout_percent (and status='on' at 100%) on the parent flag.
    await this.db
      .update(featureFlags)
      .set({
        rolloutPercent: target,
        status: target === 100 ? "on" : "canary",
        updatedAt: now,
      })
      .where(eq(featureFlags.id, run.featureFlagId));
  }

  /** Abort a running canary — sets flag back to off at 0%. */
  async abort(canaryId: string): Promise<void> {
    const [run] = await this.db
      .select()
      .from(canaryRuns)
      .where(eq(canaryRuns.id, canaryId))
      .limit(1);

    if (!run) throw new Error(`canary run ${canaryId} not found`);
    if (run.status !== "running") throw new Error(`canary run is ${run.status}, cannot abort`);

    const now = new Date();
    const entry: HistoryEntry = { percent: 0, at: now.toISOString() };
    const updatedHistory = [...(run.history as HistoryEntry[]), entry];

    await this.db
      .update(canaryRuns)
      .set({ status: "aborted", endedAt: now, history: updatedHistory })
      .where(eq(canaryRuns.id, canaryId));

    await this.db
      .update(featureFlags)
      .set({ rolloutPercent: 0, status: "off", updatedAt: now })
      .where(eq(featureFlags.id, run.featureFlagId));
  }

  async getById(canaryId: string): Promise<(typeof canaryRuns.$inferSelect) | undefined> {
    const [run] = await this.db
      .select()
      .from(canaryRuns)
      .where(eq(canaryRuns.id, canaryId))
      .limit(1);
    return run;
  }
}
