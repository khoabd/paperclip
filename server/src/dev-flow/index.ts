// Phase 7 — Development Flow + Feature Flags barrel re-export.
// HTTP routes deferred to Phase 15.

export {
  canTransitionDesignDoc,
  legalRunnerTargets,
} from "./lifecycle/design-doc-state-machine.js";
export type {
  DesignDocStatus,
  DesignDocActor,
  DesignDocTransitionInput,
  DesignDocTransitionVerdict,
} from "./lifecycle/design-doc-state-machine.js";

export { DesignDocService } from "./lifecycle/design-doc-service.js";
export type {
  CreateDesignDocInput,
  ReviseDesignDocInput,
  TransitionDesignDocInput,
} from "./lifecycle/design-doc-service.js";

export { detectConflicts, ConflictDetector } from "./conflict/conflict-detector.js";
export type { ConflictKind, ConflictDraft } from "./conflict/conflict-detector.js";

export { FeatureFlagEvaluator, evaluatePure } from "./feature-flags/feature-flag-evaluator.js";
export type { EvalInput, EvalResult, EvalSource } from "./feature-flags/feature-flag-evaluator.js";

export { CanaryController, CANARY_STAGES } from "./feature-flags/canary-controller.js";
export type { CanaryStage, HistoryEntry } from "./feature-flags/canary-controller.js";
