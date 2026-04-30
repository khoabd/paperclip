// PerRepoBrier — computes Brier calibration scoped to a KB repository.
// Joins decision_log.payload->>'repo_id' to the provided repoId, persists a
// brier_calibration row with scope='repo'. Phase 12 §Services.4.

import { and, eq, gte, isNotNull, ne } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { brierCalibration, decisionLog } from "@paperclipai/db";

export interface RepoBrierResult {
  repoId: string;
  n: number;
  brier: number;
  meanConfidence: number;
  meanOutcome: number;
  calibrationId: string;
}

function outcomeToBinary(outcome: string): number {
  return outcome === "success" ? 1 : 0;
}

export class PerRepoBrier {
  constructor(private readonly db: Db) {}

  /**
   * Queries decision_log rows where payload->>'repo_id' = repoId, within the
   * last `windowDays` days, with resolved outcomes. Computes Brier score and
   * persists a brier_calibration row with scope='repo', scope_id=repoId.
   */
  async computeForRepo(repoId: string, windowDays = 30): Promise<RepoBrierResult> {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    // Pull all resolved rows then filter by payload.repo_id in JS.
    // Drizzle jsonb operators differ by version; using a JS filter is safe
    // and avoids raw SQL for Phase 12 scope.
    const rows = await this.db
      .select({
        confidence: decisionLog.confidence,
        outcome: decisionLog.outcome,
        payload: decisionLog.payload,
      })
      .from(decisionLog)
      .where(
        and(
          gte(decisionLog.createdAt, since),
          isNotNull(decisionLog.outcomeRecordedAt),
          ne(decisionLog.outcome, "pending"),
        ),
      );

    const repoRows = rows.filter(
      (r) =>
        r.payload != null &&
        typeof r.payload === "object" &&
        (r.payload as Record<string, unknown>)["repo_id"] === repoId,
    );

    const n = repoRows.length;

    if (n === 0) {
      const [cal] = await this.db
        .insert(brierCalibration)
        .values({
          scope: "repo",
          scopeId: repoId,
          windowDays,
          n: 0,
          brierScore: "0",
          meanConfidence: null,
          meanOutcome: null,
          computedAt: new Date(),
        })
        .returning({ id: brierCalibration.id });

      return {
        repoId,
        n: 0,
        brier: 0,
        meanConfidence: 0,
        meanOutcome: 0,
        calibrationId: cal.id,
      };
    }

    let sumBrier = 0;
    let sumConfidence = 0;
    let sumOutcome = 0;

    for (const row of repoRows) {
      const c = Number(row.confidence);
      const o = outcomeToBinary(row.outcome ?? "pending");
      sumBrier += Math.pow(c - o, 2);
      sumConfidence += c;
      sumOutcome += o;
    }

    const brier = sumBrier / n;
    const meanConfidence = sumConfidence / n;
    const meanOutcome = sumOutcome / n;

    const [cal] = await this.db
      .insert(brierCalibration)
      .values({
        scope: "repo",
        scopeId: repoId,
        windowDays,
        n,
        brierScore: String(brier),
        meanConfidence: String(meanConfidence),
        meanOutcome: String(meanOutcome),
        computedAt: new Date(),
      })
      .returning({ id: brierCalibration.id });

    return { repoId, n, brier, meanConfidence, meanOutcome, calibrationId: cal.id };
  }
}
