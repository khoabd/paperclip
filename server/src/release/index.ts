// Phase 15 — Release Hardening
// Barrel re-export. No HTTP routes.

export { HealthMetricsCollector, computeHealthStatus } from "./health-metrics-collector.js";
export type {
  RecordMetricInput,
  HealthMetricRow,
  HealthStatus,
} from "./health-metrics-collector.js";

export { ExplainAuditService } from "./explain-audit-service.js";
export type {
  ActionKind,
  RecordActionInput,
  AuditRecordRow,
} from "./explain-audit-service.js";

export { MigrationOrchestrator } from "./migration-orchestrator.js";
export type {
  MigrationKind,
  MigrationStatus,
  StartMigrationInput,
  MigrationRow,
} from "./migration-orchestrator.js";

export { SecretsRotationRunbook } from "./secrets-rotation-runbook.js";
export type {
  SecretKind,
  SecretAction,
  RecordRotationInput,
  RotationAuditRow,
} from "./secrets-rotation-runbook.js";

export { FullSystemGateChecker } from "./full-system-gate-checker.js";
export type {
  CriterionResult,
  GateReport,
} from "./full-system-gate-checker.js";

export { createObservabilityFacade } from "./observability-facade.js";
export type {
  ObservabilityFacade,
  ObservabilityFacadeOptions,
} from "./observability-facade.js";
