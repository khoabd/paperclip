// Hotfix forward-port runner per Phase-13-Release-Trains §hotfix-runner.
// Walks pending hotfix commits on a release branch and tries to forward-port them onto
// main. Three outcomes:
//   1. clean cherry-pick                                       → outcome=clean
//   2. simple conflict that the merge agent resolves           → outcome=auto_resolved
//   3. deep conflict (multi-file or semantic)                  → outcome=escalated (Approval Center)

import { eq } from "drizzle-orm";
import {
  approvals,
  hotfixAttempts,
  type createDb,
} from "@paperclipai/db";

export type HotfixDb = ReturnType<typeof createDb>;

export type CherryPickResult =
  | { kind: "clean" }
  | { kind: "conflict"; severity: "simple" | "deep"; affectedFiles: string[] };

export interface CherryPickAdapter {
  cherryPick(input: {
    sourceBranch: string;
    targetBranch: string;
    commitSha: string;
  }): Promise<CherryPickResult>;
}

export interface MergeAgent {
  attemptResolve(input: {
    targetBranch: string;
    commitSha: string;
    affectedFiles: string[];
  }): Promise<{ resolved: boolean; reason?: string }>;
}

export type HotfixOutcome = "clean" | "auto_resolved" | "escalated" | "failed";

export type HotfixAttemptResult = {
  attemptId: string;
  outcome: HotfixOutcome;
  conflictSeverity: "simple" | "deep" | null;
  approvalId: string | null;
  agentAttempts: number;
};

const DEEP_CONFLICT_FILE_THRESHOLD = 3;

export class HotfixRunner {
  constructor(
    private readonly db: HotfixDb,
    private readonly cherryPicker: CherryPickAdapter,
    private readonly mergeAgent: MergeAgent,
  ) {}

  async run(input: {
    companyId: string;
    sourceBranch: string;
    targetBranch: string;
    commitSha: string;
  }): Promise<HotfixAttemptResult> {
    const startedAt = new Date();
    const result = await this.cherryPicker.cherryPick({
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      commitSha: input.commitSha,
    });

    if (result.kind === "clean") {
      const attemptId = await this.persist({
        ...input,
        outcome: "clean",
        conflictSeverity: null,
        agentAttempts: 0,
        approvalId: null,
        details: { result: "clean" },
        startedAt,
      });
      return {
        attemptId,
        outcome: "clean",
        conflictSeverity: null,
        approvalId: null,
        agentAttempts: 0,
      };
    }

    const severity =
      result.severity === "deep" || result.affectedFiles.length >= DEEP_CONFLICT_FILE_THRESHOLD
        ? "deep"
        : "simple";

    if (severity === "deep") {
      const approvalId = await this.escalate({
        companyId: input.companyId,
        commitSha: input.commitSha,
        affectedFiles: result.affectedFiles,
      });
      const attemptId = await this.persist({
        ...input,
        outcome: "escalated",
        conflictSeverity: "deep",
        agentAttempts: 0,
        approvalId,
        details: { affectedFiles: result.affectedFiles },
        startedAt,
      });
      return {
        attemptId,
        outcome: "escalated",
        conflictSeverity: "deep",
        approvalId,
        agentAttempts: 0,
      };
    }

    // Simple conflict: ask the merge agent.
    const agentResult = await this.mergeAgent.attemptResolve({
      targetBranch: input.targetBranch,
      commitSha: input.commitSha,
      affectedFiles: result.affectedFiles,
    });

    if (agentResult.resolved) {
      const attemptId = await this.persist({
        ...input,
        outcome: "auto_resolved",
        conflictSeverity: "simple",
        agentAttempts: 1,
        approvalId: null,
        details: { affectedFiles: result.affectedFiles },
        startedAt,
      });
      return {
        attemptId,
        outcome: "auto_resolved",
        conflictSeverity: "simple",
        approvalId: null,
        agentAttempts: 1,
      };
    }

    // Agent failed too — escalate even though severity started as simple.
    const approvalId = await this.escalate({
      companyId: input.companyId,
      commitSha: input.commitSha,
      affectedFiles: result.affectedFiles,
      reason: agentResult.reason ?? "merge agent could not resolve",
    });
    const attemptId = await this.persist({
      ...input,
      outcome: "escalated",
      conflictSeverity: "simple",
      agentAttempts: 1,
      approvalId,
      details: { affectedFiles: result.affectedFiles, reason: agentResult.reason },
      startedAt,
    });
    return {
      attemptId,
      outcome: "escalated",
      conflictSeverity: "simple",
      approvalId,
      agentAttempts: 1,
    };
  }

  private async persist(input: {
    companyId: string;
    sourceBranch: string;
    targetBranch: string;
    commitSha: string;
    outcome: HotfixOutcome;
    conflictSeverity: "simple" | "deep" | null;
    agentAttempts: number;
    approvalId: string | null;
    details: Record<string, unknown>;
    startedAt: Date;
  }): Promise<string> {
    const [row] = await this.db
      .insert(hotfixAttempts)
      .values({
        companyId: input.companyId,
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
        commitSha: input.commitSha,
        outcome: input.outcome,
        conflictSeverity: input.conflictSeverity,
        agentAttempts: input.agentAttempts,
        approvalId: input.approvalId,
        details: input.details,
        startedAt: input.startedAt,
        finishedAt: new Date(),
      })
      .returning();
    return row.id;
  }

  private async escalate(input: {
    companyId: string;
    commitSha: string;
    affectedFiles: string[];
    reason?: string;
  }): Promise<string> {
    const [row] = await this.db
      .insert(approvals)
      .values({
        companyId: input.companyId,
        type: "hotfix_conflict",
        proposalPattern: "decide",
        priority: "high",
        riskLevel: "high",
        canDelegate: true,
        payload: {
          context: input.reason ?? "Hotfix forward-port conflict requires human review",
          commitSha: input.commitSha,
          affectedFiles: input.affectedFiles,
        },
        metadata: { surface: "hotfix-runner" },
      })
      .returning({ id: approvals.id });
    return row.id;
  }
}
