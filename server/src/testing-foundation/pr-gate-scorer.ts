// PRGateScorer — computes weighted test score for a PR and determines block status.
// Phase 14a §Services.5.
//
// Block criteria (ANY of):
//   • Any dimension score < 60
//   • Critical a11y violations present
//   • Any cross_browser_results.diff_pixel_count > 1000

import { eq, and, gt } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { testRuns } from "@paperclipai/db/schema/test_runs";
import { a11yViolations } from "@paperclipai/db/schema/a11y_violations";
import { crossBrowserResults } from "@paperclipai/db/schema/cross_browser_results";

export interface PRGateResult {
  blocked: boolean;
  score: number;
  weakDimensions: string[];
}

export class PRGateScorer {
  constructor(private readonly db: Db) {}

  /**
   * Pulls all test_runs for the PR, computes an aggregate weighted score,
   * identifies weak dimensions, and applies hard-block criteria.
   *
   * Returns { blocked, score, weakDimensions }.
   */
  async scoreForPR(prRef: string): Promise<PRGateResult> {
    const runs = await this.db
      .select()
      .from(testRuns)
      .where(eq(testRuns.prRef, prRef));

    const weakDimensions: string[] = [];
    let totalWeight = 0;
    let weightedScore = 0;
    let blocked = false;

    for (const run of runs) {
      const score = run.score != null ? parseFloat(String(run.score)) : 0;
      // Each dimension has equal weight of 1 in this phase
      totalWeight += 1;
      weightedScore += score;

      if (score < 60) {
        weakDimensions.push(run.dimension);
        blocked = true;
      }
    }

    const aggregateScore = totalWeight > 0 ? weightedScore / totalWeight : 0;

    // Check for critical a11y violations across all test runs for this PR
    const a11yRunIds = runs
      .filter((r) => r.dimension === "a11y")
      .map((r) => r.id);

    if (a11yRunIds.length > 0) {
      for (const runId of a11yRunIds) {
        const criticals = await this.db
          .select({ id: a11yViolations.id })
          .from(a11yViolations)
          .where(
            and(
              eq(a11yViolations.testRunId, runId),
              eq(a11yViolations.impact, "critical"),
            ),
          );

        if (criticals.length > 0) {
          blocked = true;
          if (!weakDimensions.includes("a11y")) {
            weakDimensions.push("a11y");
          }
        }
      }
    }

    // Check for cross-browser results with diff > 1000 pixels
    const cbRunIds = runs
      .filter((r) => r.dimension === "cross_browser")
      .map((r) => r.id);

    if (cbRunIds.length > 0) {
      for (const runId of cbRunIds) {
        const bigDiffs = await this.db
          .select({ id: crossBrowserResults.id })
          .from(crossBrowserResults)
          .where(
            and(
              eq(crossBrowserResults.testRunId, runId),
              gt(crossBrowserResults.diffPixelCount, 1000),
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

    return {
      blocked,
      score: Math.round(aggregateScore * 100) / 100,
      weakDimensions,
    };
  }
}
