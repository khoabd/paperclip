import { Router } from "express";
import { and, eq, inArray, not, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issues, heartbeatRuns, agents, issueRelations } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess } from "./authz.js";

type Row = Record<string, unknown>;

function rows(result: Iterable<Row>): Row[] {
  return Array.from(result);
}

export function projectHealthRoutes(db: Db) {
  const router = Router();

  /**
   * GET /companies/:companyId/projects/:projectId/health
   * Summary stats, active work, stale blockers, recent failed runs.
   */
  router.get("/companies/:companyId/projects/:projectId/health", async (req, res) => {
    const { companyId, projectId } = req.params as { companyId: string; projectId: string };
    assertBoard(req);
    assertCompanyAccess(req, companyId);

    try {
      // 1. Summary stats
      const statusRows = await db
        .select({ status: issues.status, count: sql<number>`count(*)::int` })
        .from(issues)
        .where(and(eq(issues.companyId, companyId), eq(issues.projectId, projectId)))
        .groupBy(issues.status);

      const summary = {
        total: 0, done: 0, in_progress: 0, in_review: 0,
        blocked: 0, todo: 0, backlog: 0, cancelled: 0,
      };
      for (const row of statusRows) {
        const s = row.status as keyof typeof summary;
        if (s in summary) summary[s] = Number(row.count);
        summary.total += Number(row.count);
      }

      // 2. Active issues (in_progress + in_review)
      const activeRows = await db
        .select({
          id: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          agentName: agents.name,
        })
        .from(issues)
        .leftJoin(agents, eq(agents.id, issues.assigneeAgentId))
        .where(and(
          eq(issues.companyId, companyId),
          eq(issues.projectId, projectId),
          inArray(issues.status, ["in_progress", "in_review"]),
        ))
        .orderBy(issues.updatedAt);

      // 3. Stale blocking relations — blocker is not "done"
      const blockedResult = await db.execute(sql`
        SELECT
          blocked.id,
          blocked.identifier,
          blocked.title,
          blocked.status,
          a.name AS agent_name,
          blocker.id AS blocker_id,
          blocker.identifier AS blocker_identifier,
          blocker.title AS blocker_title,
          blocker.status AS blocker_status,
          ir.id AS relation_id
        FROM issue_relations ir
        JOIN issues blocked ON blocked.id = ir.related_issue_id
        JOIN issues blocker ON blocker.id = ir.issue_id
        LEFT JOIN agents a ON a.id = blocked.assignee_agent_id
        WHERE blocked.company_id = ${companyId}
          AND blocked.project_id = ${projectId}
          AND blocker.status != 'done'
          AND blocked.status != 'cancelled'
        ORDER BY blocked.identifier
      `);

      // 4. Recent adapter-level failed runs (joined through issues for project scope)
      const failedResult = await db.execute(sql`
        SELECT
          hr.id AS run_id,
          hr.error_code,
          hr.error,
          hr.finished_at,
          a.id AS agent_id,
          a.name AS agent_name,
          i.id AS issue_id,
          i.identifier AS issue_identifier,
          i.title AS issue_title,
          i.status AS issue_status
        FROM heartbeat_runs hr
        JOIN agents a ON a.id = hr.agent_id
        LEFT JOIN issues i ON i.id = (hr.context_snapshot->>'issueId')::uuid
        WHERE hr.company_id = ${companyId}
          AND hr.status IN ('failed', 'error')
          AND hr.error_code IN ('adapter_failed', 'process_lost')
          AND i.project_id = ${projectId}
          AND hr.finished_at > now() - interval '7 days'
        ORDER BY hr.finished_at DESC
        LIMIT 30
      `);

      res.json({
        summary,
        active: activeRows,
        staleBlockers: rows(blockedResult),
        failedRuns: rows(failedResult),
      });
    } catch (err) {
      console.error("[project-health] GET error", err);
      res.status(500).json({ error: "Failed to load project health" });
    }
  });

  /**
   * POST /companies/:companyId/projects/:projectId/health/unblock-stale
   * Removes issue_relations where blocker is not "done", resets blocked issues to "todo".
   */
  router.post("/companies/:companyId/projects/:projectId/health/unblock-stale", async (req, res) => {
    const { companyId, projectId } = req.params as { companyId: string; projectId: string };
    assertBoard(req);
    assertCompanyAccess(req, companyId);

    try {
      const staleResult = await db.execute(sql`
        SELECT ir.id AS relation_id, ir.related_issue_id AS blocked_issue_id
        FROM issue_relations ir
        JOIN issues blocked ON blocked.id = ir.related_issue_id
        JOIN issues blocker ON blocker.id = ir.issue_id
        WHERE blocked.company_id = ${companyId}
          AND blocked.project_id = ${projectId}
          AND blocker.status != 'done'
          AND blocked.status != 'cancelled'
      `);

      const staleRows = rows(staleResult);
      if (staleRows.length === 0) {
        res.json({ removedRelations: 0, resetIssues: 0 });
        return;
      }

      const relationIds = staleRows.map((r) => r.relation_id as string);
      const blockedIssueIds = [...new Set(staleRows.map((r) => r.blocked_issue_id as string))];

      await db.delete(issueRelations).where(inArray(issueRelations.id, relationIds));

      const resetResult = await db
        .update(issues)
        .set({ status: "todo", updatedAt: new Date() })
        .where(and(
          inArray(issues.id, blockedIssueIds),
          eq(issues.status, "blocked"),
        ))
        .returning({ id: issues.id });

      res.json({
        removedRelations: relationIds.length,
        resetIssues: resetResult.length,
        issueIds: blockedIssueIds,
      });
    } catch (err) {
      console.error("[project-health] unblock-stale error", err);
      res.status(500).json({ error: "Failed to unblock stale issues" });
    }
  });

  /**
   * POST /companies/:companyId/projects/:projectId/health/cancel-sentinels
   * Cancels stuck blocker issues (e.g. "Recover stalled" tasks) that are not done.
   */
  router.post("/companies/:companyId/projects/:projectId/health/cancel-sentinels", async (req, res) => {
    const { companyId, projectId } = req.params as { companyId: string; projectId: string };
    assertBoard(req);
    assertCompanyAccess(req, companyId);

    try {
      const sentinelResult = await db.execute(sql`
        SELECT DISTINCT blocker.id, blocker.identifier, blocker.status
        FROM issue_relations ir
        JOIN issues blocked ON blocked.id = ir.related_issue_id
        JOIN issues blocker ON blocker.id = ir.issue_id
        WHERE blocked.company_id = ${companyId}
          AND blocked.project_id = ${projectId}
          AND blocker.status NOT IN ('done', 'cancelled')
      `);

      const sentinelRows = rows(sentinelResult);
      if (sentinelRows.length === 0) {
        res.json({ cancelled: 0, sentinels: [] });
        return;
      }

      const ids = sentinelRows.map((r) => r.id as string);
      await db
        .update(issues)
        .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
        .where(and(
          inArray(issues.id, ids),
          not(inArray(issues.status, ["done", "cancelled"])),
        ));

      res.json({
        cancelled: ids.length,
        sentinels: sentinelRows.map((r) => r.identifier as string),
      });
    } catch (err) {
      console.error("[project-health] cancel-sentinels error", err);
      res.status(500).json({ error: "Failed to cancel sentinel issues" });
    }
  });

  return router;
}
