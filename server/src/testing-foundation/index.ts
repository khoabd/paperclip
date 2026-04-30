// Phase 14a — Testing Foundation barrel export.
export { TestRunStore } from "./test-run-store.js";
export type { CreateTestRunInput, TestRunRow } from "./test-run-store.js";

export { VisualBaselineStore } from "./visual-baseline-store.js";
export type { RegisterBaselineInput, VisualBaselineRow } from "./visual-baseline-store.js";

export { A11yViolationCollector } from "./a11y-violation-collector.js";
export type { AxeViolation, ImpactSummary } from "./a11y-violation-collector.js";

export { CrossBrowserRunner } from "./cross-browser-runner.js";
export type {
  ScreenshotterFn,
  DifferFn,
  RunMatrixInput,
  CrossBrowserCellResult,
} from "./cross-browser-runner.js";

export { PRGateScorer } from "./pr-gate-scorer.js";
export type { PRGateResult } from "./pr-gate-scorer.js";
