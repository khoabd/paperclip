// CrossDeviceMatrix — orchestrates a device-class × viewport matrix run.
// Real BrowserStack burst lives in an adapter injected via `screenshotter`.
// Phase 14b §Services.2.

import type { Db } from "@paperclipai/db";
import { crossDeviceResults } from "@paperclipai/db/schema/cross_device_results";

/** BrowserStack-shaped device spec. */
export interface DeviceSpec {
  /** mobile | tablet | desktop | wide_desktop */
  deviceClass: string;
  viewport: string;
  browser: string;
}

export type DeviceScreenshotter = (opts: {
  deviceClass: string;
  viewport: string;
  browser: string;
  route: string;
}) => Promise<{ uri: string; diffPixelCount?: number }>;

export interface RunMatrixInput {
  route: string;
  devices: DeviceSpec[];
  screenshotter: DeviceScreenshotter;
}

export interface CrossDeviceCellResult {
  deviceClass: string;
  viewport: string;
  browser: string;
  screenshotUri: string | null;
  diffPixelCount: number | null;
  /** passed | failed | errored */
  status: string;
}

/**
 * Maps BrowserStack device categories to internal device_class values.
 * Mobile: viewport width < 600
 * Tablet: 600–1023
 * Desktop: 1024–1439
 * WideDesktop: >= 1440
 */
export function classifyViewport(viewport: string): string {
  const width = parseInt(viewport.split("x")[0], 10);
  if (isNaN(width)) return "desktop";
  if (width < 600) return "mobile";
  if (width < 1024) return "tablet";
  if (width < 1440) return "desktop";
  return "wide_desktop";
}

export class CrossDeviceMatrix {
  constructor(private readonly db: Db) {}

  /**
   * Runs the full device matrix for the given testRunId.
   * For each device spec:
   *   1. Calls the injected `screenshotter` (adapter or stub).
   *   2. Determines status: diffPixelCount > 1000 → 'failed', else 'passed'.
   *   3. Persists one cross_device_results row.
   * Returns the array of cell results.
   */
  async runMatrix(
    testRunId: string,
    input: RunMatrixInput,
  ): Promise<CrossDeviceCellResult[]> {
    const results: CrossDeviceCellResult[] = [];

    for (const device of input.devices) {
      let screenshotUri: string | null = null;
      let diffPixelCount: number | null = null;
      let status = "passed";

      try {
        const shot = await input.screenshotter({
          deviceClass: device.deviceClass,
          viewport: device.viewport,
          browser: device.browser,
          route: input.route,
        });

        screenshotUri = shot.uri;
        diffPixelCount = shot.diffPixelCount ?? null;

        if (diffPixelCount !== null && diffPixelCount > 1000) {
          status = "failed";
        }
      } catch {
        status = "errored";
      }

      await this.db
        .insert(crossDeviceResults)
        .values({
          testRunId,
          deviceClass: device.deviceClass,
          viewport: device.viewport,
          browser: device.browser,
          screenshotUri,
          status,
          diffPixelCount,
          createdAt: new Date(),
        });

      results.push({
        deviceClass: device.deviceClass,
        viewport: device.viewport,
        browser: device.browser,
        screenshotUri,
        diffPixelCount,
        status,
      });
    }

    return results;
  }
}
