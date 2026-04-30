import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { sprints, sprintIssues } from "@paperclipai/db";
import { eq, and } from "drizzle-orm";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";

export function sprintRoutes(db: Db) {
  const router = Router();

  router.get("/companies/:companyId/sprints", async (req, res) => {
    const { companyId } = req.params;
    assertCompanyAccess(req, companyId);
    const rows = await db.query.sprints.findMany({
      where: (s, { eq }) => eq(s.companyId, companyId),
      orderBy: (s, { desc }) => [desc(s.createdAt)],
    });
    res.json(rows);
  });

  router.get("/sprints/:id", async (req, res) => {
    const { id } = req.params;
    const sprint = await db.query.sprints.findFirst({
      where: (s, { eq }) => eq(s.id, id),
    });
    if (!sprint) { res.status(404).json({ error: "Sprint not found" }); return; }
    assertCompanyAccess(req, sprint.companyId);
    const issues = await db.query.sprintIssues.findMany({
      where: (si, { eq }) => eq(si.sprintId, id),
    });
    res.json({ ...sprint, issues });
  });

  router.post("/companies/:companyId/sprints", async (req, res) => {
    const { companyId } = req.params;
    assertCompanyAccess(req, companyId);
    const { name, goal, projectId, startDate, endDate } = req.body as {
      name: string; goal?: string; projectId?: string;
      startDate?: string; endDate?: string;
    };
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const [sprint] = await db.insert(sprints).values({
      companyId,
      projectId: projectId ?? null,
      name,
      goal: goal ?? null,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
    }).returning();
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "sprint.created",
      entityType: "sprint",
      entityId: sprint.id,
      details: { name },
    });
    res.status(201).json(sprint);
  });

  router.patch("/sprints/:id", async (req, res) => {
    const { id } = req.params;
    const existing = await db.query.sprints.findFirst({ where: (s, { eq }) => eq(s.id, id) });
    if (!existing) { res.status(404).json({ error: "Sprint not found" }); return; }
    assertCompanyAccess(req, existing.companyId);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ["name", "goal", "status", "velocity"] as const) {
      if (key in req.body) patch[key] = req.body[key];
    }
    if ("startDate" in req.body) patch.startDate = req.body.startDate ? new Date(req.body.startDate) : null;
    if ("endDate" in req.body) patch.endDate = req.body.endDate ? new Date(req.body.endDate) : null;
    if (req.body.status === "completed" && !existing.completedAt) patch.completedAt = new Date();
    const [updated] = await db.update(sprints).set(patch).where(eq(sprints.id, id)).returning();
    res.json(updated);
  });

  router.delete("/sprints/:id", async (req, res) => {
    const { id } = req.params;
    const existing = await db.query.sprints.findFirst({ where: (s, { eq }) => eq(s.id, id) });
    if (!existing) { res.status(404).json({ error: "Sprint not found" }); return; }
    assertCompanyAccess(req, existing.companyId);
    await db.delete(sprints).where(eq(sprints.id, id));
    res.status(204).send();
  });

  router.post("/sprints/:id/issues", async (req, res) => {
    const { id } = req.params;
    const sprint = await db.query.sprints.findFirst({ where: (s, { eq }) => eq(s.id, id) });
    if (!sprint) { res.status(404).json({ error: "Sprint not found" }); return; }
    assertCompanyAccess(req, sprint.companyId);
    const { issueId } = req.body as { issueId: string };
    if (!issueId) { res.status(400).json({ error: "issueId is required" }); return; }
    const [row] = await db.insert(sprintIssues)
      .values({ sprintId: id, issueId })
      .onConflictDoNothing()
      .returning();
    res.status(201).json(row ?? { sprintId: id, issueId });
  });

  router.delete("/sprints/:id/issues/:issueId", async (req, res) => {
    const { id, issueId } = req.params;
    const sprint = await db.query.sprints.findFirst({ where: (s, { eq }) => eq(s.id, id) });
    if (!sprint) { res.status(404).json({ error: "Sprint not found" }); return; }
    assertCompanyAccess(req, sprint.companyId);
    await db.delete(sprintIssues).where(
      and(eq(sprintIssues.sprintId, id), eq(sprintIssues.issueId, issueId)),
    );
    res.status(204).send();
  });

  return router;
}
