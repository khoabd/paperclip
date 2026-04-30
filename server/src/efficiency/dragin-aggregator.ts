// Drag-in self-report aggregation per ADR-0008.
// "Drag-in" = user reports they had to manually intervene (drag in) during an approval flow.
// High drag-in rate = autonomy is set too aggressively. Low drag-in = system can be trusted more.
// The Efficiency Reviewer reads aggregates and recommends autonomy-dial adjustments.

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { approvals, type createDb } from "@paperclipai/db";

export type EfficiencyDb = ReturnType<typeof createDb>;

export type DragInAggregate = {
  companyId: string;
  weekStart: Date;
  totalApprovals: number;
  dragInCount: number;
  dragInRate: number;
};

export type EfficiencyRecommendation =
  | { kind: "no_action"; reason: string }
  | { kind: "bump_autonomy"; reason: string }
  | { kind: "reduce_autonomy"; reason: string }
  | { kind: "auditor_review"; reason: string }
  | { kind: "critical_alert"; reason: string };

const BUMP_THRESHOLD = 0.1; // < 10% → bump
const REDUCE_THRESHOLD = 0.2; // ≥ 20% → reduce
const CRITICAL_THRESHOLD = 0.5; // ≥ 50% → critical alert
const MIN_SAMPLE_FOR_ACTION = 5;

function startOfWeekUtc(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = out.getUTCDay(); // 0 = Sunday
  out.setUTCDate(out.getUTCDate() - dow);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

export class DragInAggregator {
  constructor(private readonly db: EfficiencyDb) {}

  async aggregateForWeek(opts: { companyId: string; weekStart: Date }): Promise<DragInAggregate> {
    const weekStart = startOfWeekUtc(opts.weekStart);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3_600_000);

    const rows = await this.db
      .select({
        total: sql<number>`COUNT(*)::int`,
        dragInCount: sql<number>`SUM(CASE WHEN ${approvals.metadata}->>'dragIn' = 'true' THEN 1 ELSE 0 END)::int`,
      })
      .from(approvals)
      .where(
        and(
          eq(approvals.companyId, opts.companyId),
          gte(approvals.decidedAt, weekStart),
          lte(approvals.decidedAt, weekEnd),
        ),
      );

    const total = Number(rows[0]?.total ?? 0);
    const dragInCount = Number(rows[0]?.dragInCount ?? 0);
    const rate = total === 0 ? 0 : dragInCount / total;

    return {
      companyId: opts.companyId,
      weekStart,
      totalApprovals: total,
      dragInCount,
      dragInRate: rate,
    };
  }
}

export class EfficiencyReviewer {
  constructor(private readonly db: EfficiencyDb) {}

  async recommendForWorkspace(opts: {
    companyId: string;
    weekStart: Date;
  }): Promise<{ aggregate: DragInAggregate; recommendation: EfficiencyRecommendation }> {
    const aggregator = new DragInAggregator(this.db);
    const aggregate = await aggregator.aggregateForWeek(opts);

    const recommendation = this.recommendFromAggregate(aggregate);
    return { aggregate, recommendation };
  }

  recommendFromAggregate(aggregate: DragInAggregate): EfficiencyRecommendation {
    const { dragInRate, totalApprovals } = aggregate;

    if (totalApprovals < MIN_SAMPLE_FOR_ACTION) {
      return {
        kind: "no_action",
        reason: `sample too small: ${totalApprovals} approvals (< ${MIN_SAMPLE_FOR_ACTION})`,
      };
    }

    if (dragInRate >= CRITICAL_THRESHOLD) {
      return {
        kind: "critical_alert",
        reason: `drag-in rate ${(dragInRate * 100).toFixed(1)}% breaches critical (${CRITICAL_THRESHOLD * 100}%)`,
      };
    }

    if (dragInRate >= REDUCE_THRESHOLD) {
      // 20% – 50% range: depending on policy, recommend reduce OR auditor review.
      // Default policy: auditor review for the first breach, reduce only on repeat (callers persist state).
      return {
        kind: "auditor_review",
        reason: `drag-in rate ${(dragInRate * 100).toFixed(1)}% ≥ ${REDUCE_THRESHOLD * 100}%; flag for auditor before reducing autonomy`,
      };
    }

    if (dragInRate < BUMP_THRESHOLD) {
      if (dragInRate === 0) {
        return {
          kind: "no_action",
          reason: "0% drag-in but no signal of overload either; hold steady",
        };
      }
      return {
        kind: "bump_autonomy",
        reason: `drag-in rate ${(dragInRate * 100).toFixed(1)}% < ${BUMP_THRESHOLD * 100}%; safe to bump autonomy`,
      };
    }

    return {
      kind: "no_action",
      reason: `drag-in rate ${(dragInRate * 100).toFixed(1)}% within steady band`,
    };
  }
}
