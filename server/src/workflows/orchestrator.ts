import { and, isNull, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issues } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { logger } from "../middleware/logger.js";
import { buildIssueWorkflowGraph } from "./graph.js";
import type { HeartbeatDep } from "./nodes.js";

export class IssueOrchestrator {
  private graph: ReturnType<typeof buildIssueWorkflowGraph>;
  private db: Db;
  private heartbeat: HeartbeatDep;
  private activeWorkflows = new Map<string, Promise<void>>();

  constructor(db: Db, heartbeat: HeartbeatDep) {
    this.db = db;
    this.heartbeat = heartbeat;
    this.graph = buildIssueWorkflowGraph(db, heartbeat);
  }

  /**
   * Trigger workflow for a single issue (fire-and-forget, tracked in activeWorkflows).
   */
  triggerForIssue(issueId: string, companyId: string): void {
    if (this.activeWorkflows.has(issueId)) {
      logger.debug({ issueId }, "workflow already active, skipping");
      return;
    }

    const promise = this.runWorkflow(issueId, companyId).finally(() => {
      this.activeWorkflows.delete(issueId);
    });

    this.activeWorkflows.set(issueId, promise);
  }

  private async runWorkflow(issueId: string, companyId: string): Promise<void> {
    // Check if issue still needs assignment (idempotent guard)
    const rows = await this.db
      .select({
        id: issues.id,
        companyId: issues.companyId,
        title: issues.title,
        description: issues.description,
        assigneeAgentId: issues.assigneeAgentId,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .limit(1);

    const issue = rows[0];
    if (!issue) {
      logger.warn({ issueId }, "issue not found, skipping workflow");
      return;
    }

    if (issue.assigneeAgentId) {
      logger.debug({ issueId }, "issue already assigned, skipping workflow");
      return;
    }

    try {
      await this.graph.invoke({
        issueId: issue.id,
        companyId: issue.companyId,
        title: issue.title,
        description: issue.description ?? "",
      });
      logger.info({ issueId }, "workflow completed");
    } catch (err) {
      logger.error({ err, issueId }, "workflow failed");
    }
  }

  /**
   * Scan DB for unassigned todo/backlog issues and trigger workflow for each.
   * Returns number of workflows triggered.
   */
  async scanAndOrchestrate(companyId?: string): Promise<number> {
    const conditions = [
      isNull(issues.assigneeAgentId),
      inArray(issues.status, ["todo", "backlog"]),
    ];

    if (companyId) {
      conditions.push(eq(issues.companyId, companyId));
    }

    const unassigned = await this.db
      .select({
        id: issues.id,
        companyId: issues.companyId,
        title: issues.title,
        description: issues.description,
      })
      .from(issues)
      .where(and(...conditions))
      .limit(100);

    let triggered = 0;
    for (const issue of unassigned) {
      if (this.activeWorkflows.has(issue.id)) continue;
      this.triggerForIssue(issue.id, issue.companyId);
      triggered++;
    }

    logger.info({ triggered, companyId }, "scan-and-orchestrate complete");
    return triggered;
  }

  /**
   * Start periodic scanner. Returns cleanup function.
   */
  startScheduler(intervalMs = 5 * 60 * 1000): () => void {
    const timer = setInterval(() => {
      void this.scanAndOrchestrate().catch((err) => {
        logger.error({ err }, "scheduled scan-and-orchestrate failed");
      });
    }, intervalMs);

    // Unref so it doesn't keep the process alive
    timer.unref?.();

    return () => clearInterval(timer);
  }

  get activeCount(): number {
    return this.activeWorkflows.size;
  }
}

export function createOrchestrator(db: Db, heartbeat: HeartbeatDep): IssueOrchestrator {
  return new IssueOrchestrator(db, heartbeat);
}
