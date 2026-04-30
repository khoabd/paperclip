// Computes Brier calibration scores from decision_log and persists rows to brier_calibration.
// Per Phase 9 spec §Services.4.

import { and, eq, gte, isNotNull, ne } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { brierCalibration, decisionLog } from "@paperclipai/db";

export interface BrierResult {
  n: number;
  brier: number;
  meanConfidence: number;
  meanOutcome: number;
  calibrationId: string;
}

// outcome → binary value for Brier computation
function outcomeToBinary(outcome: string): number {
  return outcome === "success" ? 1 : 0;
}

export class BrierScorer {
  constructor(private readonly db: Db) {}

  async computeForAgent(agentId: string, windowDays = 30): Promise<BrierResult> {
    return this._compute("agent", agentId, windowDays, [eq(decisionLog.agentId, agentId)]);
  }

  async computeForCapability(capabilityId: string, windowDays = 30): Promise<BrierResult> {
    return this._compute("capability", capabilityId, windowDays, [
      eq(decisionLog.decisionClassId, capabilityId),
    ]);
  }

  async computeForWorkspace(companyId: string, windowDays = 30): Promise<BrierResult> {
    return this._compute("workspace", companyId, windowDays, [
      eq(decisionLog.companyId, companyId),
    ]);
  }

  async computeGlobal(windowDays = 30): Promise<BrierResult> {
    return this._compute("global", "global", windowDays, []);
  }

  private async _compute(
    scope: string,
    scopeId: string,
    windowDays: number,
    extraFilters: Array<SQL | SQLWrapper | undefined>,
  ): Promise<BrierResult> {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const allConditions: Array<SQL | SQLWrapper | undefined> = [
      gte(decisionLog.createdAt, since),
      isNotNull(decisionLog.outcomeRecordedAt),
      ne(decisionLog.outcome, "pending"),
      ...extraFilters,
    ];

    const rows = await this.db
      .select({
        confidence: decisionLog.confidence,
        outcome: decisionLog.outcome,
      })
      .from(decisionLog)
      .where(and(...allConditions));

    if (rows.length === 0) {
      // No data — persist a zero-n row so callers can detect insufficient data
      const calibrationRows = await this.db
        .insert(brierCalibration)
        .values({
          scope,
          scopeId,
          windowDays,
          n: 0,
          brierScore: "0",
          meanConfidence: null,
          meanOutcome: null,
          computedAt: new Date(),
        })
        .returning({ id: brierCalibration.id });

      return { n: 0, brier: 0, meanConfidence: 0, meanOutcome: 0, calibrationId: calibrationRows[0].id };
    }

    let sumBrier = 0;
    let sumConfidence = 0;
    let sumOutcome = 0;

    for (const row of rows) {
      const c = Number(row.confidence);
      const o = outcomeToBinary(row.outcome ?? "pending");
      sumBrier += Math.pow(c - o, 2);
      sumConfidence += c;
      sumOutcome += o;
    }

    const n = rows.length;
    const brier = sumBrier / n;
    const meanConfidence = sumConfidence / n;
    const meanOutcome = sumOutcome / n;

    const calibrationRows = await this.db
      .insert(brierCalibration)
      .values({
        scope,
        scopeId,
        windowDays,
        n,
        brierScore: String(brier),
        meanConfidence: String(meanConfidence),
        meanOutcome: String(meanOutcome),
        computedAt: new Date(),
      })
      .returning({ id: brierCalibration.id });

    return { n, brier, meanConfidence, meanOutcome, calibrationId: calibrationRows[0].id };
  }
}
