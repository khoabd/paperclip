import { Router } from "express";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "@paperclipai/db";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

function layoutDir(): string {
  return join(resolvePaperclipInstanceRoot(), "data", "console-layouts");
}

function layoutPath(companyId: string): string {
  return join(layoutDir(), `${companyId}.json`);
}

function readLayout(companyId: string): Record<string, { x: number; y: number }> {
  const p = layoutPath(companyId);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as Record<string, { x: number; y: number }>;
  } catch {
    return {};
  }
}

function writeLayout(companyId: string, layout: unknown): void {
  const dir = layoutDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(layoutPath(companyId), JSON.stringify(layout, null, 2), "utf-8");
}

export function consolePreferenceRoutes(_db: Db) {
  const router = Router();

  router.get("/companies/:companyId/console-layout", (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    res.json(readLayout(companyId));
  });

  router.put("/companies/:companyId/console-layout", (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    if (typeof req.body !== "object" || req.body === null) {
      res.status(400).json({ error: "Invalid layout payload" });
      return;
    }
    writeLayout(companyId, req.body);
    res.json({ ok: true });
  });

  return router;
}
