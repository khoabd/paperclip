// Records agent decisions to decision_log and updates outcomes + Brier contributions.
// Per Phase 9 spec §Services.2.

import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { decisionLog } from "@paperclipai/db";

export type OutcomeValue = "success" | "failure" | "partial" | "abandoned";

export interface RecordDecisionInput {
  companyId: string;
  missionId?: string | null;
  agentId?: string | null;
  decisionClassId?: string | null;
  kind: string;
  reversibility: string;
  blastRadius: string;
  confidence: number;
  riskScore: number;
  thresholdUsed: number;
  gated: boolean;
  approvalId?: string | null;
  payload?: Record<string, unknown>;
}

export interface RecordDecisionResult {
  decisionId: string;
  outcome: "pending";
}

export interface RecordOutcomeResult {
  decisionId: string;
  outcome: OutcomeValue;
  brierContribution: number;
}

function toBinary(outcome: OutcomeValue): number {
  return outcome === "success" ? 1 : 0;
}

export class DecisionLogger {
  constructor(private readonly db: Db) {}

  /**
   * Insert a new decision log row with outcome='pending'.
   * Returns the newly created row's id.
   */
  async record(input: RecordDecisionInput): Promise<RecordDecisionResult> {
    const rows = await this.db
      .insert(decisionLog)
      .values({
        companyId: input.companyId,
        missionId: input.missionId ?? null,
        agentId: input.agentId ?? null,
        decisionClassId: input.decisionClassId ?? null,
        kind: input.kind,
        reversibility: input.reversibility,
        blastRadius: input.blastRadius,
        confidence: String(input.confidence),
        riskScore: String(input.riskScore),
        thresholdUsed: String(input.thresholdUsed),
        gated: input.gated,
        approvalId: input.approvalId ?? null,
        outcome: "pending",
        payload: input.payload ?? {},
      })
      .returning({ id: decisionLog.id });

    return { decisionId: rows[0].id, outcome: "pending" };
  }

  /**
   * Record the outcome of a decision: updates the row, computes Brier contribution.
   * brierContribution = (confidence − outcomeBinary)²
   */
  async recordOutcome(decisionId: string, outcome: OutcomeValue): Promise<RecordOutcomeResult> {
    // Load the existing row to get confidence
    const existing = await this.db
      .select({
        id: decisionLog.id,
        confidence: decisionLog.confidence,
      })
      .from(decisionLog)
      .where(and(eq(decisionLog.id, decisionId), isNull(decisionLog.outcomeRecordedAt)))
      .limit(1);

    if (!existing[0]) {
      throw new Error(
        `DecisionLogger.recordOutcome: no pending decision found with id=${decisionId}`,
      );
    }

    const confidence = Number(existing[0].confidence);
    const outcomeBinary = toBinary(outcome);
    const brierContribution = Math.pow(confidence - outcomeBinary, 2);

    await this.db
      .update(decisionLog)
      .set({
        outcome,
        outcomeRecordedAt: new Date(),
        brierContribution: String(brierContribution),
      })
      .where(eq(decisionLog.id, decisionId));

    return { decisionId, outcome, brierContribution };
  }
}
