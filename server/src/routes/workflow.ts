import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import type { IssueOrchestrator } from "../workflows/orchestrator.js";

export function workflowRoutes(db: Db, orchestrator: IssueOrchestrator) {
  // db is available for future use (e.g., issue lookup before triggering)
  void db;

  const router = Router();

  /**
   * POST /companies/:companyId/workflow/triage
   * Body: { issueId?: string }
   * Triage a single issue or all unassigned issues in the company.
   */
  router.post("/companies/:companyId/workflow/triage", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);

    const { issueId } = req.body as { issueId?: string };

    if (issueId) {
      orchestrator.triggerForIssue(issueId, companyId);
      res.status(202).json({ queued: true, issueId });
      return;
    }

    const triggered = await orchestrator.scanAndOrchestrate(companyId);
    res.status(202).json({ queued: true, triggered });
  });

  /**
   * GET /companies/:companyId/workflow/status
   * Returns number of active workflows.
   */
  router.get("/companies/:companyId/workflow/status", (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);

    res.json({ activeWorkflows: orchestrator.activeCount });
  });

  return router;
}
