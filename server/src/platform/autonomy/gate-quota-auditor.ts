// Weekly gate-quota auditor per Phase-9-Autonomy-Tuning §gate-rate-watch.
// Counts approvals raised against a workspace in a rolling 7-day window. If the
// count exceeds the workspace's gate quota (default 8), recommend an autonomy
// review; if it sits at zero with no other activity, flag underutilisation.

import { and, count, eq, gte, lte } from "drizzle-orm";
import { approvals, type createDb } from "@paperclipai/db";

export type AuditorDb = ReturnType<typeof createDb>;

export type GateQuotaReport = {
  companyId: string;
  windowStart: Date;
  windowEnd: Date;
  gatesRaised: number;
  quota: number;
  breached: boolean;
  recommendation: GateQuotaRecommendation;
};

export type GateQuotaRecommendation =
  | { kind: "no_action"; reason: string }
  | { kind: "increase_autonomy"; severity: "MEDIUM"; reason: string }
  | { kind: "review_gate_triggers"; severity: "MEDIUM"; reason: string }
  | { kind: "underutilised"; severity: "LOW"; reason: string };

const DEFAULT_QUOTA = 8;
const WINDOW_MS = 7 * 24 * 3_600_000;
const UNDERUTILISED_THRESHOLD = 0;

export class GateQuotaAuditor {
  constructor(
    private readonly db: AuditorDb,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async audit(opts: { companyId: string; quotaPerWeek?: number }): Promise<GateQuotaReport> {
    const quota = opts.quotaPerWeek ?? DEFAULT_QUOTA;
    const windowEnd = this.now();
    const windowStart = new Date(windowEnd.getTime() - WINDOW_MS);

    const rows = await this.db
      .select({ c: count() })
      .from(approvals)
      .where(
        and(
          eq(approvals.companyId, opts.companyId),
          gte(approvals.createdAt, windowStart),
          lte(approvals.createdAt, windowEnd),
        ),
      );

    const gatesRaised = Number(rows[0]?.c ?? 0);
    const breached = gatesRaised > quota;

    let recommendation: GateQuotaRecommendation;
    if (breached) {
      // Slightly over → review triggers; way over → assume autonomy too low.
      const overshoot = gatesRaised - quota;
      if (overshoot >= Math.max(2, quota * 0.25)) {
        recommendation = {
          kind: "increase_autonomy",
          severity: "MEDIUM",
          reason: `${gatesRaised} gates in 7d (quota ${quota}, overshoot ${overshoot}); autonomy likely too restrictive`,
        };
      } else {
        recommendation = {
          kind: "review_gate_triggers",
          severity: "MEDIUM",
          reason: `${gatesRaised} gates in 7d (quota ${quota}); review which gates are firing before adjusting autonomy`,
        };
      }
    } else if (gatesRaised <= UNDERUTILISED_THRESHOLD) {
      recommendation = {
        kind: "underutilised",
        severity: "LOW",
        reason: "0 gates raised in last 7d; either no work happened or autonomy is over-permissive",
      };
    } else {
      recommendation = {
        kind: "no_action",
        reason: `${gatesRaised} gates in 7d, within quota ${quota}`,
      };
    }

    return {
      companyId: opts.companyId,
      windowStart,
      windowEnd,
      gatesRaised,
      quota,
      breached,
      recommendation,
    };
  }
}
