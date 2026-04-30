// Phase 12 — Cross-Repo Coordination barrel export.
export { SagaOrchestrator } from "./saga-orchestrator.js";
export type { SagaStepDef, StepRunner, CompensateRunner, SagaStartResult } from "./saga-orchestrator.js";

export { ContractRegistry } from "./contract-registry.js";
export type { RegisterContractInput, ContractRow } from "./contract-registry.js";

export { VectorClockAuditor } from "./vector-clock-auditor.js";
export type { ClockComparison, ClockRow } from "./vector-clock-auditor.js";

export { PerRepoBrier } from "./per-repo-brier.js";
export type { RepoBrierResult } from "./per-repo-brier.js";
