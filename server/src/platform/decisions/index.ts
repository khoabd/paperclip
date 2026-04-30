// Barrel re-export for the decisions platform module.
// Per Phase 9 spec — service layer only, no HTTP routes.

export { DecisionClassifier } from "./decision-classifier.js";
export type {
  ClassifyInput,
  ClassifyResult,
  Reversibility,
  BlastRadius,
} from "./decision-classifier.js";
export { BASE_THRESHOLDS, AUTONOMY_FACTOR, MAX_THRESHOLD } from "./decision-classifier.js";

export { DecisionLogger } from "./decision-logger.js";
export type {
  RecordDecisionInput,
  RecordDecisionResult,
  RecordOutcomeResult,
  OutcomeValue,
} from "./decision-logger.js";

export { UncertaintyEmitter } from "./uncertainty-emitter.js";
export type { UncertaintyKind } from "./uncertainty-emitter.js";

export { BrierScorer } from "./brier-scorer.js";
export type { BrierResult } from "./brier-scorer.js";

export { TrustPromotionGuard } from "./trust-promotion-guard.js";
export type { PromotionCheckResult } from "./trust-promotion-guard.js";
export { BRIER_THRESHOLD, DEFAULT_MIN_DECISIONS, STALENESS_DAYS } from "./trust-promotion-guard.js";

export { BrierRunner, runOnce } from "./brier-runner.js";
export type { BrierRunnerResult } from "./brier-runner.js";
