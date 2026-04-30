// MobileTestStore — persistence layer for mobile_test_runs rows.
// Real Appium execution lives in adapters; this store accepts injected session metadata.
// Phase 14b §Services.1.

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { mobileTestRuns } from "@paperclipai/db/schema/mobile_test_runs";

export interface RecordMobileTestInput {
  /** ios | android */
  platform: string;
  deviceModel: string;
  osVersion: string;
  screenshotUri?: string | null;
  videoUri?: string | null;
  /** passed | failed | errored — defaults to 'passed' */
  status?: string;
  appiumSessionId?: string | null;
}

export interface MobileTestRunRow {
  id: string;
  testRunId: string;
  platform: string;
  deviceModel: string;
  osVersion: string;
  screenshotUri: string | null;
  videoUri: string | null;
  status: string;
  appiumSessionId: string | null;
  createdAt: Date;
}

export class MobileTestStore {
  constructor(private readonly db: Db) {}

  /**
   * Persists one mobile_test_runs row for the given test run.
   * The Appium session_id and URIs come from the adapter (injected externally).
   */
  async record(
    testRunId: string,
    input: RecordMobileTestInput,
  ): Promise<MobileTestRunRow> {
    const [row] = await this.db
      .insert(mobileTestRuns)
      .values({
        testRunId,
        platform: input.platform,
        deviceModel: input.deviceModel,
        osVersion: input.osVersion,
        screenshotUri: input.screenshotUri ?? null,
        videoUri: input.videoUri ?? null,
        status: input.status ?? "passed",
        appiumSessionId: input.appiumSessionId ?? null,
        createdAt: new Date(),
      })
      .returning();
    return row as MobileTestRunRow;
  }

  /**
   * Lists all mobile_test_runs rows associated with the given test run id.
   */
  async listByTestRun(testRunId: string): Promise<MobileTestRunRow[]> {
    const rows = await this.db
      .select()
      .from(mobileTestRuns)
      .where(eq(mobileTestRuns.testRunId, testRunId));
    return rows as MobileTestRunRow[];
  }
}
