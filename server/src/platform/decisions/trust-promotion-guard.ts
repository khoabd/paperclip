// Guards trust promotions by checking Brier calibration health.
// Blocks promotion if: brier > 0.15 OR no calibration in last 30 days with n >= minDecisions.
// Per Phase 9 spec §Services.5 — wired into AutonomyGate as a sibling helper.

import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { brierCalibration } from "@paperclipai/db";

export interface PromotionCheckResult {
  ok: boolean;
  reason: "ok" | "brier_degraded" | "insufficient_data";
  brier?: number;
  n?: number;
}

const BRIER_THRESHOLD = 0.15;
const DEFAULT_MIN_DECISIONS = 30;
const STALENESS_DAYS = 30;

export class TrustPromotionGuard {
  constructor(
    private readonly db: Db,
    private readonly minDecisions = DEFAULT_MIN_DECISIONS,
  ) {}

  /**
   * Check whether an agent is eligible for trust promotion.
   * scope: 'agent' | 'capability' | 'workspace'
   */
  async canPromote(
    scopeId: string,
    scope: "agent" | "capability" | "workspace" = "agent",
  ): Promise<PromotionCheckResult> {
    const since = new Date(Date.now() - STALENESS_DAYS * 24 * 60 * 60 * 1000);

    const rows = await this.db
      .select({
        brierScore: brierCalibration.brierScore,
        n: brierCalibration.n,
        computedAt: brierCalibration.computedAt,
      })
      .from(brierCalibration)
      .where(
        and(
          eq(brierCalibration.scope, scope),
          eq(brierCalibration.scopeId, scopeId),
          gte(brierCalibration.computedAt, since),
        ),
      )
      .orderBy(desc(brierCalibration.computedAt))
      .limit(1);

    if (rows.length === 0) {
      return { ok: false, reason: "insufficient_data" };
    }

    const latest = rows[0];
    const n = latest.n;
    const brier = Number(latest.brierScore);

    if (n < this.minDecisions) {
      return { ok: false, reason: "insufficient_data", n, brier };
    }

    if (brier > BRIER_THRESHOLD) {
      return { ok: false, reason: "brier_degraded", brier, n };
    }

    return { ok: true, reason: "ok", brier, n };
  }
}

export { BRIER_THRESHOLD, DEFAULT_MIN_DECISIONS, STALENESS_DAYS };
