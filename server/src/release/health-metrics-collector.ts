// HealthMetricsCollector — Phase 15 §Services.1
//
// Records system health metrics and computes status from value vs threshold.
//
// Status rules:
//   lower-is-better kinds (latency_p50, latency_p95, error_rate, cost_per_hour,
//     drag_in_rate, brier, stuck_event_rate):
//     green   → value ≤ threshold × 0.7
//     yellow  → value ≤ threshold
//     red     → value > threshold
//
//   higher-is-better kinds (gate_compliance, trust_promotion_rate):
//     green   → value ≥ threshold × 0.7  (threshold acts as minimum target)
//     yellow  → value ≥ threshold × 0.5
//     red     → value < threshold × 0.5

import { desc, eq, and, gte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { systemHealthMetrics } from "@paperclipai/db/schema/system_health_metrics";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOWER_IS_BETTER_KINDS = new Set([
  "latency_p50",
  "latency_p95",
  "error_rate",
  "cost_per_hour",
  "drag_in_rate",
  "brier",
  "stuck_event_rate",
]);

const HIGHER_IS_BETTER_KINDS = new Set([
  "gate_compliance",
  "trust_promotion_rate",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthStatus = "green" | "yellow" | "red";

export interface RecordMetricInput {
  companyId: string;
  /** workspace | service | mission | global */
  scope: string;
  scopeId?: string;
  kind: string;
  value: number;
  threshold?: number;
  payload?: Record<string, unknown>;
}

export interface HealthMetricRow {
  id: string;
  companyId: string;
  scope: string;
  scopeId: string | null;
  kind: string;
  value: number | null;
  threshold: number | null;
  status: string;
  payload: Record<string, unknown>;
  recordedAt: Date;
}

// ---------------------------------------------------------------------------
// Status computation
// ---------------------------------------------------------------------------

export function computeHealthStatus(
  kind: string,
  value: number,
  threshold: number | undefined,
): HealthStatus {
  if (threshold == null || threshold === 0) return "green";

  if (LOWER_IS_BETTER_KINDS.has(kind)) {
    if (value <= threshold * 0.7) return "green";
    if (value <= threshold) return "yellow";
    return "red";
  }

  if (HIGHER_IS_BETTER_KINDS.has(kind)) {
    if (value >= threshold * 0.7) return "green";
    if (value >= threshold * 0.5) return "yellow";
    return "red";
  }

  // Unknown kind: default lower-is-better
  if (value <= threshold * 0.7) return "green";
  if (value <= threshold) return "yellow";
  return "red";
}

// ---------------------------------------------------------------------------
// HealthMetricsCollector
// ---------------------------------------------------------------------------

export class HealthMetricsCollector {
  constructor(private readonly db: Db) {}

  async record(input: RecordMetricInput): Promise<HealthMetricRow> {
    const status = computeHealthStatus(input.kind, input.value, input.threshold);

    const [row] = await this.db
      .insert(systemHealthMetrics)
      .values({
        companyId: input.companyId,
        scope: input.scope,
        scopeId: input.scopeId ?? null,
        kind: input.kind,
        value: String(input.value),
        threshold: input.threshold != null ? String(input.threshold) : null,
        status,
        payload: input.payload ?? {},
      })
      .returning();

    return this.toRow(row);
  }

  async recent(
    companyId: string,
    scope: string,
    kind: string,
    limitRows = 50,
  ): Promise<HealthMetricRow[]> {
    const rows = await this.db
      .select()
      .from(systemHealthMetrics)
      .where(
        and(
          eq(systemHealthMetrics.companyId, companyId),
          eq(systemHealthMetrics.scope, scope),
          eq(systemHealthMetrics.kind, kind),
        ),
      )
      .orderBy(desc(systemHealthMetrics.recordedAt))
      .limit(limitRows);

    return rows.map((r) => this.toRow(r));
  }

  async latestStatus(companyId: string, scope: string, kind: string): Promise<HealthStatus> {
    const [row] = await this.db
      .select({ status: systemHealthMetrics.status })
      .from(systemHealthMetrics)
      .where(
        and(
          eq(systemHealthMetrics.companyId, companyId),
          eq(systemHealthMetrics.scope, scope),
          eq(systemHealthMetrics.kind, kind),
        ),
      )
      .orderBy(desc(systemHealthMetrics.recordedAt))
      .limit(1);

    return (row?.status as HealthStatus) ?? "green";
  }

  private toRow(row: typeof systemHealthMetrics.$inferSelect): HealthMetricRow {
    return {
      id: row.id,
      companyId: row.companyId,
      scope: row.scope,
      scopeId: row.scopeId ?? null,
      kind: row.kind,
      value: row.value != null ? parseFloat(row.value) : null,
      threshold: row.threshold != null ? parseFloat(row.threshold) : null,
      status: row.status,
      payload: (row.payload as Record<string, unknown>) ?? {},
      recordedAt: row.recordedAt,
    };
  }
}
