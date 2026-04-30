// Per-workspace runtime context: autonomy, weight, budget, namespaces.
// Workspace == company (per ADR-0006). This is the read model that agents/missions consult.
// Per Phase-2-Platform-Workspace-Mission-Layer §2.2.

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companies, workspaceLifecycleEvents } from "@paperclipai/db";

export type AutonomyLevel = "sandbox" | "supervised" | "trusted" | "autonomous";

export interface WorkspaceContext {
  workspaceId: string;
  name: string;
  status: string;
  autonomyLevel: AutonomyLevel;
  wfqWeight: number;
  costBudgetUsdPerWeek: number;
  ragNamespace: string | null;
  vaultPath: string | null;
  pgSchema: string | null;
}

export class WorkspaceContextStore {
  constructor(private readonly db: Db) {}

  async load(workspaceId: string): Promise<WorkspaceContext | null> {
    const row = (
      await this.db.select().from(companies).where(eq(companies.id, workspaceId)).limit(1)
    )[0];
    if (!row) return null;
    return {
      workspaceId: row.id,
      name: row.name,
      status: row.status,
      autonomyLevel: (row.autonomyLevel ?? "sandbox") as AutonomyLevel,
      wfqWeight: row.wfqWeight ?? 100,
      costBudgetUsdPerWeek: Number(row.costBudgetUsdPerWeek ?? 0),
      ragNamespace: row.ragNamespace ?? null,
      vaultPath: row.vaultPath ?? null,
      pgSchema: row.pgSchema ?? null,
    };
  }

  async logLifecycle(opts: {
    workspaceId: string;
    kind: string;
    payload?: Record<string, unknown>;
    actorUserId?: string | null;
    actorAgentId?: string | null;
  }): Promise<void> {
    await this.db.insert(workspaceLifecycleEvents).values({
      companyId: opts.workspaceId,
      kind: opts.kind,
      payload: opts.payload ?? {},
      actorUserId: opts.actorUserId ?? null,
      actorAgentId: opts.actorAgentId ?? null,
    });
  }
}
