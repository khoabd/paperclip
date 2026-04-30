// ADR-0009 timeout-action sweeper.
// Periodically scans pending approvals whose timeout_hours has elapsed and applies the
// configured `timeout_action` (auto_approve | auto_reject | escalate). Populates
// `time_to_decision_seconds` and writes a decision_note for audit.

import { and, eq, or, sql } from "drizzle-orm";
import { approvals, type createDb } from "@paperclipai/db";
import type { ApprovalTimeoutAction } from "@paperclipai/shared";

export type ApprovalsDb = ReturnType<typeof createDb>;

export type TimeoutSweepOutcome = {
  approvalId: string;
  action: ApprovalTimeoutAction;
  newStatus: string;
  newPriority: string | null;
  timeToDecisionSeconds: number;
};

const PRIORITY_ESCALATION: Record<string, string> = {
  low: "medium",
  medium: "high",
  high: "critical",
  critical: "critical",
};

function escalatePriority(current: string | null | undefined): string {
  return PRIORITY_ESCALATION[current ?? "medium"] ?? "high";
}

export class ApprovalTimeoutSweeper {
  constructor(private readonly db: ApprovalsDb, private readonly now: () => Date = () => new Date()) {}

  async sweep(): Promise<TimeoutSweepOutcome[]> {
    const now = this.now();
    const nowIso = now.toISOString();

    // Pull every pending row that has a timeout_action and has either an explicit
    // timeout_at in the past, or a timeout_hours window that has elapsed since created_at.
    const candidates = await this.db
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.status, "pending"),
          sql`${approvals.timeoutAction} IS NOT NULL`,
          or(
            and(sql`${approvals.timeoutAt} IS NOT NULL`, sql`${approvals.timeoutAt} <= ${nowIso}::timestamptz`),
            and(
              sql`${approvals.timeoutHours} IS NOT NULL`,
              sql`${approvals.createdAt} + (${approvals.timeoutHours} * INTERVAL '1 hour') <= ${nowIso}::timestamptz`,
            ),
          ),
        ),
      );

    const outcomes: TimeoutSweepOutcome[] = [];

    for (const row of candidates) {
      const action = row.timeoutAction as ApprovalTimeoutAction | null;
      if (!action) continue;

      const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
      const ttd = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 1000));

      let newStatus = row.status;
      let newPriority: string | null = null;
      let canDelegate = row.canDelegate;
      const note = `auto-${action} after ${ttd}s (timeout_hours=${row.timeoutHours ?? "n/a"})`;

      if (action === "auto_approve") {
        newStatus = "approved";
      } else if (action === "auto_reject") {
        newStatus = "rejected";
      } else if (action === "escalate") {
        newPriority = escalatePriority(row.priority);
        canDelegate = false;
      }

      const updates: Record<string, unknown> = {
        timeToDecisionSeconds: ttd,
        decisionNote: note,
        decidedAt: now,
        updatedAt: now,
      };

      if (action !== "escalate") {
        updates.status = newStatus;
        updates.outcome = action === "auto_approve" ? "auto_approved" : "auto_rejected";
        updates.outcomeRecordedAt = now;
      } else {
        updates.priority = newPriority;
        updates.canDelegate = canDelegate;
      }

      await this.db.update(approvals).set(updates).where(eq(approvals.id, row.id));

      outcomes.push({
        approvalId: row.id,
        action,
        newStatus,
        newPriority,
        timeToDecisionSeconds: ttd,
      });
    }

    return outcomes;
  }
}

// Delegation check — keep colocated to avoid new file noise.
export class ApprovalDelegationGuard {
  constructor(private readonly db: ApprovalsDb) {}

  async canUserDecide(approvalId: string, userId: string): Promise<{ allowed: boolean; reason?: string }> {
    const [row] = await this.db.select().from(approvals).where(eq(approvals.id, approvalId));
    if (!row) return { allowed: false, reason: "not_found" };
    if (row.delegatedToUserId && row.delegatedToUserId !== userId) {
      return { allowed: false, reason: "delegated_elsewhere" };
    }
    return { allowed: true };
  }

  async delegate(approvalId: string, toUserId: string): Promise<void> {
    const [row] = await this.db.select().from(approvals).where(eq(approvals.id, approvalId));
    if (!row) throw new Error(`approval not found: ${approvalId}`);
    if (!row.canDelegate) throw new Error(`approval ${approvalId} is not delegatable`);
    await this.db
      .update(approvals)
      .set({ delegatedToUserId: toUserId, updatedAt: new Date() })
      .where(eq(approvals.id, approvalId));
  }
}
