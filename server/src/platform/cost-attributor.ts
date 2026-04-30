// Per-LLM-call cost attribution. Every model call lands in mission_cost_events.
// Idempotency on (company_id, model_call_id) — required so retries/crashes don't double-count.
// Per Phase-2-Platform-Workspace-Mission-Layer §2.4 (cost).

import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { missionCostEvents, llmQuotaState } from "@paperclipai/db";

export interface CostEventInput {
  companyId: string;
  missionId?: string | null;
  agentId?: string | null;
  modelCallId: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  metadata?: Record<string, unknown>;
}

export interface RecordCostResult {
  recorded: boolean;
  duplicate: boolean;
}

export class CostAttributor {
  constructor(private readonly db: Db) {}

  /**
   * Record a model-call cost event idempotently. Returns duplicate=true if same model_call_id was seen before.
   */
  async record(event: CostEventInput): Promise<RecordCostResult> {
    const inserted = await this.db
      .insert(missionCostEvents)
      .values({
        companyId: event.companyId,
        missionId: event.missionId ?? null,
        agentId: event.agentId ?? null,
        modelCallId: event.modelCallId,
        model: event.model,
        tokensIn: event.tokensIn,
        tokensOut: event.tokensOut,
        costUsd: event.costUsd.toFixed(6),
        metadata: event.metadata ?? {},
      })
      .onConflictDoNothing({
        target: [missionCostEvents.companyId, missionCostEvents.modelCallId],
      })
      .returning({ id: missionCostEvents.id });

    if (inserted.length === 0) {
      return { recorded: false, duplicate: true };
    }

    await this.bumpQuotaState(event);
    return { recorded: true, duplicate: false };
  }

  async sumCostForCompanyBetween(companyId: string, from: Date, to: Date): Promise<number> {
    const rows = await this.db
      .select({ total: sql<string>`COALESCE(SUM(${missionCostEvents.costUsd}), 0)` })
      .from(missionCostEvents)
      .where(
        and(
          eq(missionCostEvents.companyId, companyId),
          gte(missionCostEvents.occurredAt, from),
          lte(missionCostEvents.occurredAt, to),
        ),
      );
    return Number(rows[0]?.total ?? 0);
  }

  private async bumpQuotaState(event: CostEventInput): Promise<void> {
    const week = mondayOf(new Date()).toISOString().slice(0, 10);
    const tokens = (event.tokensIn ?? 0) + (event.tokensOut ?? 0);
    await this.db
      .insert(llmQuotaState)
      .values({
        companyId: event.companyId,
        weekStart: week,
        tokensUsed: tokens,
        costUsedUsd: event.costUsd.toFixed(6),
        calls: 1,
      })
      .onConflictDoUpdate({
        target: [llmQuotaState.companyId, llmQuotaState.weekStart],
        set: {
          tokensUsed: sql`${llmQuotaState.tokensUsed} + ${tokens}`,
          costUsedUsd: sql`${llmQuotaState.costUsedUsd} + ${event.costUsd.toFixed(6)}`,
          calls: sql`${llmQuotaState.calls} + 1`,
          updatedAt: new Date(),
        },
      });
  }
}

export function mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}
