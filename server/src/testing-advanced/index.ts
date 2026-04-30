// Phase 14b — Testing Advanced barrel export.
export { MobileTestStore } from "./mobile-test-store.js";
export type { RecordMobileTestInput, MobileTestRunRow } from "./mobile-test-store.js";

export { CrossDeviceMatrix, classifyViewport } from "./cross-device-matrix.js";
export type {
  DeviceSpec,
  DeviceScreenshotter,
  RunMatrixInput,
  CrossDeviceCellResult,
} from "./cross-device-matrix.js";

export { I18nValidator, pseudoLocalizeMutation } from "./i18n-validator.js";
export type {
  DomElement,
  DomSnapshot,
  TranslatorFn,
  RunLocaleMatrixInput,
  I18nViolationRow,
} from "./i18n-validator.js";

export { UXHeuristicJudge } from "./ux-heuristic-judge.js";
export type {
  LLMJudgeInput,
  LLMJudgeDimensionResult,
  LLMCallback,
  UXJudgeScoreRow,
  JudgeResult,
} from "./ux-heuristic-judge.js";

export { AdvancedPRGateScorer } from "./advanced-pr-gate-scorer.js";
export type { AdvancedPRGateResult } from "./advanced-pr-gate-scorer.js";
