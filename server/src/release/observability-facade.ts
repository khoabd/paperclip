// ObservabilityFacade — Phase 15 §Services.6
//
// Single-import surface for all Phase 15 observability services.
// Downstream HTTP route layers mount these via: import { observability } from '../release/observability-facade.js'
// then call observability.health.record(...), observability.explain.record(...), etc.

import type { Db } from "@paperclipai/db";
import { HealthMetricsCollector } from "./health-metrics-collector.js";
import { ExplainAuditService } from "./explain-audit-service.js";
import { MigrationOrchestrator } from "./migration-orchestrator.js";
import { SecretsRotationRunbook } from "./secrets-rotation-runbook.js";

export interface ObservabilityFacadeOptions {
  db: Db;
}

export interface ObservabilityFacade {
  health: HealthMetricsCollector;
  explain: ExplainAuditService;
  migration: MigrationOrchestrator;
  secrets: SecretsRotationRunbook;
}

/**
 * Create all Phase 15 observability services bound to a single DB handle.
 * Intended usage:
 *
 *   const observability = createObservabilityFacade({ db });
 *   await observability.health.record({ ... });
 *   await observability.explain.recordAction({ ... });
 *   await observability.migration.start({ ... });
 *   await observability.secrets.recordRotation({ ... });
 */
export function createObservabilityFacade(
  options: ObservabilityFacadeOptions,
): ObservabilityFacade {
  const { db } = options;

  return {
    health: new HealthMetricsCollector(db),
    explain: new ExplainAuditService(db),
    migration: new MigrationOrchestrator(db),
    secrets: new SecretsRotationRunbook(db),
  };
}
