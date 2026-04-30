// L2TimelineEstimator — Monte Carlo estimator that pulls similar past intakes
// from the KB + outcome tracker and computes p50/p90 (closes Phase 5 deferred scope).
//
// Algorithm:
//   1. Load historical intakes with resolved outcomes (actualDays known).
//   2. Filter to similar intakes (same type ± priority).
//   3. Run N=1000 Monte Carlo samples over (complexity, velocity, autonomy_drag).
//   4. Persist via IntakeStore.addTimelineEstimate({ level: 'L2', source: 'monte_carlo' }).

import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  intakeItems,
  intakeOutcomeTracker,
  intakeTimelineEstimates,
} from "@paperclipai/db";
import { IntakeStore } from "../intake/intake-store.js";

const MONTE_CARLO_SAMPLES = 1000;

export interface L2Estimate {
  p50: number;
  p90: number;
  sampleSize: number;
  timelineRowId?: string;
}

export interface SimilarIntakeRecord {
  type: string;
  priority: string | null;
  actualDays: number;
}

export class L2TimelineEstimator {
  private readonly intakeStore: IntakeStore;

  constructor(private readonly db: Db) {
    this.intakeStore = new IntakeStore(db);
  }

  /**
   * estimate — compute L2 p50/p90 for a target intake using Monte Carlo.
   * Persists an intake_timeline_estimates row with level='L2', source='monte_carlo'.
   */
  async estimate(intakeId: string): Promise<L2Estimate> {
    // Load the target intake to know type + priority
    const target = await this.intakeStore.getById(intakeId);
    if (!target) {
      throw new Error(`Intake not found: ${intakeId}`);
    }

    // Load historical intakes with resolved outcomes
    const historicals = await this._loadHistoricalSimilar(
      target.companyId,
      target.type,
    );

    const { p50, p90 } = this._monteCarlo(historicals, target.type);

    await this.intakeStore.addTimelineEstimate({
      intakeId,
      level: "L2",
      p50Days: p50,
      p90Days: p90,
      source: "monte_carlo",
      rationale: `Monte Carlo over ${historicals.length} similar historical intakes (${MONTE_CARLO_SAMPLES} samples)`,
    });

    // Return the row ID for test assertions
    const rows = await this.db
      .select({ id: intakeTimelineEstimates.id })
      .from(intakeTimelineEstimates)
      .where(
        and(
          eq(intakeTimelineEstimates.intakeId, intakeId),
          eq(intakeTimelineEstimates.level, "L2"),
          eq(intakeTimelineEstimates.source, "monte_carlo"),
        ),
      )
      .limit(1);

    return { p50, p90, sampleSize: historicals.length, timelineRowId: rows[0]?.id };
  }

  // ---- private ----------------------------------------------------------

  private async _loadHistoricalSimilar(
    companyId: string,
    type: string,
  ): Promise<SimilarIntakeRecord[]> {
    const rows = await this.db
      .select({
        type: intakeItems.type,
        priority: intakeItems.priority,
        actualDays: intakeOutcomeTracker.actualDays,
      })
      .from(intakeItems)
      .innerJoin(
        intakeOutcomeTracker,
        eq(intakeItems.id, intakeOutcomeTracker.intakeId),
      )
      .where(
        and(
          eq(intakeItems.companyId, companyId),
          eq(intakeItems.type, type),
          isNotNull(intakeOutcomeTracker.actualDays),
        ),
      );

    return rows
      .filter((r) => r.actualDays != null)
      .map((r) => ({
        type: r.type,
        priority: r.priority,
        actualDays: Number(r.actualDays),
      }))
      .filter((r) => r.actualDays > 0);
  }

  /**
   * Monte Carlo simulation.
   *
   * Each sample draws:
   *   complexity  ~ Uniform(0.8, 1.5)
   *   velocity    ~ Uniform(0.7, 1.3)   (team velocity multiplier)
   *   autonomy    ~ Uniform(0.9, 1.1)   (autonomy drag)
   *
   * Base duration for each sample is drawn uniformly from the historical pool
   * (or from a type-based prior when pool is empty).
   */
  private _monteCarlo(
    historicals: SimilarIntakeRecord[],
    type: string,
  ): { p50: number; p90: number } {
    const samples: number[] = [];
    const rng = () => Math.random();

    for (let i = 0; i < MONTE_CARLO_SAMPLES; i++) {
      const base =
        historicals.length > 0
          ? historicals[Math.floor(rng() * historicals.length)]!.actualDays
          : typePrior(type);

      const complexity = 0.8 + rng() * 0.7;   // 0.8 – 1.5
      const velocity   = 0.7 + rng() * 0.6;   // 0.7 – 1.3
      const autonomy   = 0.9 + rng() * 0.2;   // 0.9 – 1.1

      samples.push(base * complexity * autonomy / velocity);
    }

    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(MONTE_CARLO_SAMPLES * 0.5)]!;
    const p90 = samples[Math.floor(MONTE_CARLO_SAMPLES * 0.9)]!;
    return {
      p50: Math.max(0.1, Math.round(p50 * 10) / 10),
      p90: Math.max(0.1, Math.round(p90 * 10) / 10),
    };
  }
}

/** Fallback prior when no historical data exists for a type. */
function typePrior(type: string): number {
  const map: Record<string, number> = {
    feature_request: 10,
    bug_report: 3,
    problem: 5,
    strategic_input: 2,
    question: 0.5,
  };
  return map[type] ?? 7;
}
