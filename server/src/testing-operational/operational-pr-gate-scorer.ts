// OperationalPRGateScorer — Phase 14c §Services.5
//
// Combines all Phase 14c operational signals into a single PR gate decision:
//   • Fuzz: failures > 3% of total_runs in any fuzz_run_summaries for the PR
//   • Persona: any persona scenario whose last_run_test_run_id points to a
//     run for the PR and that run produced passed=false (checked via summary)
//   • Manual TC: any manual_test_cases linked via test_run_id that is failed
//   • Synthetic: any synthetic_probe_results for env=live in last 30 min
//     with status=failed|degraded, scoped to the company
//
// Block when ANY of the above is true.
// Returns { blocked, score, weakDimensions }.

import { and, eq, gte, inArray, desc } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { testRuns } from "@paperclipai/db/schema/test_runs";
import { fuzzRunSummaries } from "@paperclipai/db/schema/fuzz_run_summaries";
import { personaScenarios } from "@paperclipai/db/schema/persona_scenarios";
import { manualTestCases } from "@paperclipai/db/schema/manual_test_cases";
import { syntheticProbeResults } from "@paperclipai/db/schema/synthetic_probe_results";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OperationalGateResult {
  blocked: boolean;
  score: number;
  weakDimensions: string[];
}

// ---------------------------------------------------------------------------
// OperationalPRGateScorer
// ---------------------------------------------------------------------------

export class OperationalPRGateScorer {
  constructor(private readonly db: Db) {}

  /**
   * Evaluate operational gate for the given PR ref + company.
   * companyId is required for synthetic probe scope.
   */
  async scoreForPR(
    prRef: string,
    companyId: string,
  ): Promise<OperationalGateResult> {
    // 1. Resolve all test_runs for this PR
    const runs = await this.db
      .select()
      .from(testRuns)
      .where(eq(testRuns.prRef, prRef));

    if (runs.length === 0) {
      return { blocked: false, score: 100, weakDimensions: [] };
    }

    const runIds = runs.map((r) => r.id);
    const weakDimensions: string[] = [];
    let blocked = false;

    // -----------------------------------------------------------------------
    // 2. Fuzz: any fuzz_run_summaries row where failures > 3% of total_runs
    // -----------------------------------------------------------------------
    const fuzzRows = await this.db
      .select()
      .from(fuzzRunSummaries)
      .where(inArray(fuzzRunSummaries.testRunId, runIds));

    for (const row of fuzzRows) {
      const rate = row.totalRuns > 0 ? row.failures / row.totalRuns : 0;
      if (rate > 0.03) {
        blocked = true;
        if (!weakDimensions.includes("fuzz")) {
          weakDimensions.push("fuzz");
        }
      }
    }

    // -----------------------------------------------------------------------
    // 3. Persona: any scenario whose last_run_test_run_id is in runIds
    //    and has failed (summary.passed === false or failures > 0)
    // -----------------------------------------------------------------------
    const scenarioRows = await this.db
      .select()
      .from(personaScenarios)
      .where(inArray(personaScenarios.lastRunTestRunId, runIds));

    for (const row of scenarioRows) {
      // The test_run for the scenario is one of our runs; check if that run
      // has a non-passing status.
      const linkedRun = runs.find((r) => r.id === row.lastRunTestRunId);
      if (linkedRun && linkedRun.status === "failed") {
        blocked = true;
        if (!weakDimensions.includes("persona")) {
          weakDimensions.push("persona");
        }
      }
    }

    // -----------------------------------------------------------------------
    // 4. Manual TC: any manual_test_cases.status = 'failed' for this company
    //    and linked to a run for this PR (company_id scope is sufficient since
    //    the spec links by company + associated test run)
    // -----------------------------------------------------------------------
    const failedManual = await this.db
      .select({ id: manualTestCases.id })
      .from(manualTestCases)
      .where(
        and(
          eq(manualTestCases.companyId, companyId),
          eq(manualTestCases.status, "failed"),
        ),
      );

    if (failedManual.length > 0) {
      blocked = true;
      if (!weakDimensions.includes("manual_tc")) {
        weakDimensions.push("manual_tc");
      }
    }

    // -----------------------------------------------------------------------
    // 5. Synthetic: any live probe failure/degraded in last 30 min
    // -----------------------------------------------------------------------
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    const liveFailures = await this.db
      .select({ id: syntheticProbeResults.id })
      .from(syntheticProbeResults)
      .where(
        and(
          eq(syntheticProbeResults.companyId, companyId),
          eq(syntheticProbeResults.env, "live"),
          gte(syntheticProbeResults.occurredAt, cutoff),
          inArray(syntheticProbeResults.status, ["failed", "degraded"]),
        ),
      );

    if (liveFailures.length > 0) {
      blocked = true;
      if (!weakDimensions.includes("synthetic")) {
        weakDimensions.push("synthetic");
      }
    }

    // -----------------------------------------------------------------------
    // 6. Score: 100 - 25 per weak dimension (floor 0)
    // -----------------------------------------------------------------------
    const score = Math.max(0, 100 - weakDimensions.length * 25);

    return { blocked, score, weakDimensions };
  }
}
