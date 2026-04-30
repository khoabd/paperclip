// ExplainAuditService — Phase 15 §Services.2
//
// Persists and retrieves the "why" chain for every auditable action in the system.
// Each action surface (mission state change, approval, kill, design doc transition,
// feature flag change, intake decision) writes one row; the full_chain JSONB column
// carries the structured reasoning steps.

import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { explainAuditRecords } from "@paperclipai/db/schema/explain_audit_records";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionKind =
  | "mission_state_change"
  | "approval"
  | "kill"
  | "design_doc_transition"
  | "feature_flag_change"
  | "intake_decision";

export interface RecordActionInput {
  companyId: string;
  actionKind: ActionKind | string;
  /** UUID of the entity that was acted upon (mission id, approval id, etc.) */
  actionId: string;
  decisionLogId?: string;
  missionId?: string;
  summary: string;
  fullChain?: unknown[];
}

export interface AuditRecordRow {
  id: string;
  companyId: string;
  actionKind: string;
  actionId: string;
  decisionLogId: string | null;
  missionId: string | null;
  summary: string;
  fullChain: unknown[];
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// ExplainAuditService
// ---------------------------------------------------------------------------

export class ExplainAuditService {
  constructor(private readonly db: Db) {}

  /** Write one audit record for an action. */
  async recordAction(input: RecordActionInput): Promise<AuditRecordRow> {
    const [row] = await this.db
      .insert(explainAuditRecords)
      .values({
        companyId: input.companyId,
        actionKind: input.actionKind,
        actionId: input.actionId,
        decisionLogId: input.decisionLogId ?? null,
        missionId: input.missionId ?? null,
        summary: input.summary,
        fullChain: input.fullChain ?? [],
      })
      .returning();

    return this.toRow(row);
  }

  /** Return the audit records for a specific action, oldest first. */
  async lookupForAction(
    actionKind: string,
    actionId: string,
  ): Promise<AuditRecordRow[]> {
    const rows = await this.db
      .select()
      .from(explainAuditRecords)
      .where(
        and(
          eq(explainAuditRecords.actionKind, actionKind),
          eq(explainAuditRecords.actionId, actionId),
        ),
      )
      .orderBy(asc(explainAuditRecords.createdAt));

    return rows.map((r) => this.toRow(r));
  }

  /** Return all audit records for a company action-kind, most recent first. */
  async listForCompany(
    companyId: string,
    actionKind: string,
    limitRows = 50,
  ): Promise<AuditRecordRow[]> {
    const { desc } = await import("drizzle-orm");
    const rows = await this.db
      .select()
      .from(explainAuditRecords)
      .where(
        and(
          eq(explainAuditRecords.companyId, companyId),
          eq(explainAuditRecords.actionKind, actionKind),
        ),
      )
      .orderBy(desc(explainAuditRecords.createdAt))
      .limit(limitRows);

    return rows.map((r) => this.toRow(r));
  }

  private toRow(row: typeof explainAuditRecords.$inferSelect): AuditRecordRow {
    return {
      id: row.id,
      companyId: row.companyId,
      actionKind: row.actionKind,
      actionId: row.actionId,
      decisionLogId: row.decisionLogId ?? null,
      missionId: row.missionId ?? null,
      summary: row.summary,
      fullChain: (row.fullChain as unknown[]) ?? [],
      createdAt: row.createdAt,
    };
  }
}
