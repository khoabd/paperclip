// SyntheticProbeRunner — Phase 14c §Services.3
//
// Records production synthetic probe results and queries recent failures.
// Actual probe execution lives outside this service (cron + external adapters).
// This service exposes only write (recordResult) and read (recentForEnv) paths.

import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { syntheticProbeResults } from "@paperclipai/db/schema/synthetic_probe_results";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProbeEnv = "dev" | "stag" | "live";
export type ProbeStatus = "passed" | "failed" | "degraded";

export interface RecordProbeInput {
  companyId: string;
  probeName: string;
  env: ProbeEnv;
  status: ProbeStatus;
  latencyMs?: number;
  errorText?: string;
  screenshotUri?: string;
  /** Defaults to now() in DB; can be overridden for back-filling. */
  occurredAt?: Date;
}

export interface ProbeResultRow {
  id: string;
  companyId: string;
  probeName: string;
  env: string;
  status: string;
  latencyMs: number | null;
  errorText: string | null;
  screenshotUri: string | null;
  occurredAt: Date;
}

// ---------------------------------------------------------------------------
// SyntheticProbeRunner
// ---------------------------------------------------------------------------

export class SyntheticProbeRunner {
  constructor(private readonly db: Db) {}

  /**
   * Persist one probe result.
   * Called by the production cron adapter and by tests.
   */
  async recordResult(input: RecordProbeInput): Promise<ProbeResultRow> {
    const values: typeof syntheticProbeResults.$inferInsert = {
      companyId: input.companyId,
      probeName: input.probeName,
      env: input.env,
      status: input.status,
      latencyMs: input.latencyMs ?? null,
      errorText: input.errorText ?? null,
      screenshotUri: input.screenshotUri ?? null,
    };

    if (input.occurredAt != null) {
      values.occurredAt = input.occurredAt;
    }

    const [row] = await this.db
      .insert(syntheticProbeResults)
      .values(values)
      .returning();

    return this.mapRow(row);
  }

  /**
   * Return probe results for `companyId` + `env` within the last
   * `lookbackMin` minutes, sorted descending by `occurred_at`.
   */
  async recentForEnv(
    companyId: string,
    env: ProbeEnv,
    lookbackMin: number,
  ): Promise<ProbeResultRow[]> {
    const cutoff = new Date(Date.now() - lookbackMin * 60 * 1000);

    const rows = await this.db
      .select()
      .from(syntheticProbeResults)
      .where(
        and(
          eq(syntheticProbeResults.companyId, companyId),
          eq(syntheticProbeResults.env, env),
          gte(syntheticProbeResults.occurredAt, cutoff),
        ),
      )
      .orderBy(desc(syntheticProbeResults.occurredAt));

    return rows.map((r) => this.mapRow(r));
  }

  // ---------------------------------------------------------------------------

  private mapRow(
    row: typeof syntheticProbeResults.$inferSelect,
  ): ProbeResultRow {
    return {
      id: row.id,
      companyId: row.companyId,
      probeName: row.probeName,
      env: row.env,
      status: row.status,
      latencyMs: row.latencyMs ?? null,
      errorText: row.errorText ?? null,
      screenshotUri: row.screenshotUri ?? null,
      occurredAt: row.occurredAt,
    };
  }
}
