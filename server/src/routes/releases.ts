import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { releases } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";

export function releaseRoutes(db: Db) {
  const router = Router();

  router.get("/companies/:companyId/releases", async (req, res) => {
    const { companyId } = req.params;
    assertCompanyAccess(req, companyId);
    const rows = await db.query.releases.findMany({
      where: (r, { eq }) => eq(r.companyId, companyId),
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    });
    res.json(rows);
  });

  router.get("/releases/:id", async (req, res) => {
    const { id } = req.params;
    const release = await db.query.releases.findFirst({ where: (r, { eq }) => eq(r.id, id) });
    if (!release) { res.status(404).json({ error: "Release not found" }); return; }
    assertCompanyAccess(req, release.companyId);
    res.json(release);
  });

  router.post("/companies/:companyId/releases", async (req, res) => {
    const { companyId } = req.params;
    assertCompanyAccess(req, companyId);
    const { version, name, notes, projectId, sprintId } = req.body as {
      version: string; name?: string; notes?: string;
      projectId?: string; sprintId?: string;
    };
    if (!version) { res.status(400).json({ error: "version is required" }); return; }
    const [release] = await db.insert(releases).values({
      companyId,
      projectId: projectId ?? null,
      sprintId: sprintId ?? null,
      version,
      name: name ?? null,
      notes: notes ?? null,
    }).returning();
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "release.created",
      entityType: "release",
      entityId: release.id,
      details: { version },
    });
    res.status(201).json(release);
  });

  router.patch("/releases/:id", async (req, res) => {
    const { id } = req.params;
    const existing = await db.query.releases.findFirst({ where: (r, { eq }) => eq(r.id, id) });
    if (!existing) { res.status(404).json({ error: "Release not found" }); return; }
    assertCompanyAccess(req, existing.companyId);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ["version", "name", "notes", "status"] as const) {
      if (key in req.body) patch[key] = req.body[key];
    }
    const [updated] = await db.update(releases).set(patch).where(eq(releases.id, id)).returning();
    res.json(updated);
  });

  router.post("/releases/:id/publish", async (req, res) => {
    const { id } = req.params;
    const existing = await db.query.releases.findFirst({ where: (r, { eq }) => eq(r.id, id) });
    if (!existing) { res.status(404).json({ error: "Release not found" }); return; }
    assertCompanyAccess(req, existing.companyId);
    const now = new Date();
    const [updated] = await db.update(releases)
      .set({ status: "published", publishedAt: now, updatedAt: now })
      .where(eq(releases.id, id))
      .returning();
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "release.published",
      entityType: "release",
      entityId: id,
      details: { version: existing.version },
    });
    res.json(updated);
  });

  router.delete("/releases/:id", async (req, res) => {
    const { id } = req.params;
    const existing = await db.query.releases.findFirst({ where: (r, { eq }) => eq(r.id, id) });
    if (!existing) { res.status(404).json({ error: "Release not found" }); return; }
    assertCompanyAccess(req, existing.companyId);
    await db.delete(releases).where(eq(releases.id, id));
    res.status(204).send();
  });

  return router;
}
