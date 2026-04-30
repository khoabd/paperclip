// AdvancedPRGateScorer — extends PRGateScorer to cover Phase 14b dimensions.
// Pulls mobile_test_runs, cross_device_results, i18n_violations, ux_judge_scores
// for the PR's test_runs and computes block status.
// Phase 14b §Services.5.
//
// Block criteria (ANY triggers block):
//   • Any dimension with aggregate score < 60
//   • Any mobile_test_runs.status = 'failed' or 'errored'
//   • Any cross_device_results.diff_pixel_count > 1000
//   • Any i18n_violations.severity = 'critical'
//   • Any ux_judge_scores.score < 50 for any dimension

import { eq, and, gt, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { testRuns } from "@paperclipai/db/schema/test_runs";
import { mobileTestRuns } from "@paperclipai/db/schema/mobile_test_runs";
import { crossDeviceResults } from "@paperclipai/db/schema/cross_device_results";
import { i18nViolations } from "@paperclipai/db/schema/i18n_violations";
import { uxJudgeScores } from "@paperclipai/db/schema/ux_judge_scores";

export interface AdvancedPRGateResult {
  blocked: boolean;
  score: number;
  weakDimensions: string[];
}

export class AdvancedPRGateScorer {
  constructor(private readonly db: Db) {}

  /**
   * Scores the 14b dimensions for the given PR ref.
   *
   * Returns { blocked, score, weakDimensions } where weakDimensions may
   * contain any of: 'mobile', 'cross_device', 'i18n', 'ux_judge'.
   */
  async scoreForPR(prRef: string): Promise<AdvancedPRGateResult> {
    const runs = await this.db
      .select()
      .from(testRuns)
      .where(eq(testRuns.prRef, prRef));

    const weakDimensions: string[] = [];
    let blocked = false;
    let totalWeight = 0;
    let weightedScore = 0;

    // --- Aggregate dimension scores ---
    for (const run of runs) {
      const score = run.score != null ? parseFloat(String(run.score)) : 0;
      totalWeight += 1;
      weightedScore += score;

      if (score < 60) {
        if (!weakDimensions.includes(run.dimension)) {
          weakDimensions.push(run.dimension);
        }
        blocked = true;
      }
    }

    const aggregateScore = totalWeight > 0 ? weightedScore / totalWeight : 0;

    const runIds = runs.map((r) => r.id);
    if (runIds.length === 0) {
      return { blocked: false, score: 0, weakDimensions: [] };
    }

    // --- mobile_test_runs: any failed/errored → block ---
    const mobileRunIds = runs
      .filter((r) => r.dimension === "mobile")
      .map((r) => r.id);

    if (mobileRunIds.length > 0) {
      for (const runId of mobileRunIds) {
        const failedMobile = await this.db
          .select({ id: mobileTestRuns.id })
          .from(mobileTestRuns)
          .where(
            and(
              eq(mobileTestRuns.testRunId, runId),
              inArray(mobileTestRuns.status, ["failed", "errored"]),
            ),
          );
        if (failedMobile.length > 0) {
          blocked = true;
          if (!weakDimensions.includes("mobile")) {
            weakDimensions.push("mobile");
          }
        }
      }
    }

    // --- cross_device_results: diff_pixel_count > 1000 → block ---
    // cross_device runs are registered with dimension='cross_browser' (shared dimension slot).
    const crossDeviceRunIds = runs
      .filter((r) => r.dimension === "cross_browser")
      .map((r) => r.id);

    if (crossDeviceRunIds.length > 0) {
      for (const runId of crossDeviceRunIds) {
        const bigDiffs = await this.db
          .select({ id: crossDeviceResults.id })
          .from(crossDeviceResults)
          .where(
            and(
              eq(crossDeviceResults.testRunId, runId),
              gt(crossDeviceResults.diffPixelCount, 1000),
            ),
          );
        if (bigDiffs.length > 0) {
          blocked = true;
          if (!weakDimensions.includes("cross_browser")) {
            weakDimensions.push("cross_browser");
          }
        }
      }
    }

    // --- i18n_violations: any critical → block ---
    const i18nRunIds = runs
      .filter((r) => r.dimension === "i18n")
      .map((r) => r.id);

    if (i18nRunIds.length > 0) {
      for (const runId of i18nRunIds) {
        const criticals = await this.db
          .select({ id: i18nViolations.id })
          .from(i18nViolations)
          .where(
            and(
              eq(i18nViolations.testRunId, runId),
              eq(i18nViolations.severity, "critical"),
            ),
          );
        if (criticals.length > 0) {
          blocked = true;
          if (!weakDimensions.includes("i18n")) {
            weakDimensions.push("i18n");
          }
        }
      }
    }

    // --- ux_judge_scores: any score < 50 → block ---
    const uxRunIds = runs
      .filter((r) => r.dimension === "ux_judge")
      .map((r) => r.id);

    if (uxRunIds.length > 0) {
      for (const runId of uxRunIds) {
        const allScores = await this.db
          .select()
          .from(uxJudgeScores)
          .where(eq(uxJudgeScores.testRunId, runId));
        const hasLowScore = allScores.some(
          (s) => parseFloat(String(s.score)) < 50,
        );
        if (hasLowScore) {
          blocked = true;
          if (!weakDimensions.includes("ux_judge")) {
            weakDimensions.push("ux_judge");
          }
        }
      }
    }

    return {
      blocked,
      score: Math.round(aggregateScore * 100) / 100,
      weakDimensions,
    };
  }
}
