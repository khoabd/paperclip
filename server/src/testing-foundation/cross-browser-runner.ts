// CrossBrowserRunner — orchestrates a browser×viewport matrix test run.
// Real Playwright/screenshot lives in adapters; this service accepts injected callbacks.
// Phase 14a §Services.4.

import type { Db } from "@paperclipai/db";
import { crossBrowserResults } from "@paperclipai/db/schema/cross_browser_results";
import { VisualBaselineStore } from "./visual-baseline-store.js";

export type ScreenshotterFn = (opts: {
  browser: string;
  viewport: string;
  route: string;
}) => Promise<{ uri: string; sha: string }>;

export type DifferFn = (opts: {
  currentUri: string;
  baselineUri: string;
}) => Promise<{ diffPixelCount: number }>;

export interface RunMatrixInput {
  /** Company id owning this run */
  companyId: string;
  route: string;
  browsers: string[];
  viewports: string[];
}

export interface CrossBrowserCellResult {
  browser: string;
  viewport: string;
  screenshotUri: string;
  diffPixelCount: number | null;
  baselineId: string | null;
  /** passed | failed | new_baseline_needed */
  status: string;
}

export class CrossBrowserRunner {
  private readonly baselineStore: VisualBaselineStore;

  constructor(
    private readonly db: Db,
    private readonly screenshotter: ScreenshotterFn,
    private readonly differ: DifferFn,
  ) {
    this.baselineStore = new VisualBaselineStore(db);
  }

  /**
   * Runs the full browser×viewport matrix for the given testRunId.
   * For each cell:
   *   1. Calls `screenshotter` to get current screenshot URI + sha.
   *   2. Looks up active baseline.
   *      - If none: status = 'new_baseline_needed', registers current as baseline.
   *      - If found: calls `differ`, sets status based on diff threshold (>1000 px → failed).
   *   3. Persists a cross_browser_results row.
   * Returns the array of cell results.
   */
  async runMatrix(
    testRunId: string,
    input: RunMatrixInput,
  ): Promise<CrossBrowserCellResult[]> {
    const results: CrossBrowserCellResult[] = [];

    for (const browser of input.browsers) {
      for (const viewport of input.viewports) {
        const { uri: screenshotUri, sha } = await this.screenshotter({
          browser,
          viewport,
          route: input.route,
        });

        const active = await this.baselineStore.findActive(
          input.companyId,
          input.route,
          viewport,
          browser,
        );

        let diffPixelCount: number | null = null;
        let baselineId: string | null = null;
        let status: string;

        if (!active) {
          // No baseline yet — register current screenshot as the new baseline
          const newBaseline = await this.baselineStore.register({
            company: input.companyId,
            route: input.route,
            viewport,
            browser,
            imageUri: screenshotUri,
            sha,
          });
          baselineId = newBaseline.id;
          status = "new_baseline_needed";
        } else {
          baselineId = active.id;
          const diff = await this.differ({
            currentUri: screenshotUri,
            baselineUri: active.imageUri,
          });
          diffPixelCount = diff.diffPixelCount;
          // Hard-block threshold: > 1000 pixels different
          status = diff.diffPixelCount > 1000 ? "failed" : "passed";
        }

        const [inserted] = await this.db
          .insert(crossBrowserResults)
          .values({
            testRunId,
            browser,
            viewport,
            screenshotUri,
            diffPixelCount,
            baselineId,
            status,
            createdAt: new Date(),
          })
          .returning({ id: crossBrowserResults.id });

        results.push({
          browser,
          viewport,
          screenshotUri,
          diffPixelCount,
          baselineId,
          status,
        });
      }
    }

    return results;
  }
}
