// Nightly Brier calibration runner.
// Iterates active workspaces + agents and writes brier_calibration rows.
// No cron wiring (Phase 7 ships HTTP/cron infra later) — exposes runOnce().
// Per Phase 9 spec §Services.6.

import { eq, ne } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, companies } from "@paperclipai/db";
import { BrierScorer } from "./brier-scorer.js";

export interface BrierRunnerResult {
  workspacesProcessed: number;
  agentsProcessed: number;
  errors: string[];
}

export class BrierRunner {
  private readonly scorer: BrierScorer;

  constructor(
    private readonly db: Db,
    private readonly windowDays = 30,
  ) {
    this.scorer = new BrierScorer(db);
  }

  async runOnce(): Promise<BrierRunnerResult> {
    const errors: string[] = [];
    let workspacesProcessed = 0;
    let agentsProcessed = 0;

    // Compute workspace-level calibration for all active companies
    const activeCompanies = await this.db
      .select({ id: companies.id })
      .from(companies)
      .where(ne(companies.status, "archived"));

    for (const company of activeCompanies) {
      try {
        await this.scorer.computeForWorkspace(company.id, this.windowDays);
        workspacesProcessed++;
      } catch (err) {
        errors.push(`workspace:${company.id}: ${String(err)}`);
      }
    }

    // Compute agent-level calibration for all active agents
    const activeAgents = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.status, "idle")); // includes all non-archived agents

    for (const agent of activeAgents) {
      try {
        await this.scorer.computeForAgent(agent.id, this.windowDays);
        agentsProcessed++;
      } catch (err) {
        errors.push(`agent:${agent.id}: ${String(err)}`);
      }
    }

    // Global calibration
    try {
      await this.scorer.computeGlobal(this.windowDays);
    } catch (err) {
      errors.push(`global: ${String(err)}`);
    }

    return { workspacesProcessed, agentsProcessed, errors };
  }
}

/** Convenience export for cron harness */
export async function runOnce(db: Db, windowDays = 30): Promise<BrierRunnerResult> {
  return new BrierRunner(db, windowDays).runOnce();
}
