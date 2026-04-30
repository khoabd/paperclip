// Greenfield Bootstrap — barrel re-export.
// Per Phase-8-Greenfield-Bootstrap §8.2. No HTTP routes (deferred to Phase 15).

export {
  canTransitionStage,
  canTransitionIntake,
  canApplyRecovery,
  recoveryResultStageStatus,
  isTerminalIntake,
  isTerminalStage,
  STAGE_SEQUENCE,
  type IntakeStatus,
  type StageStatus,
  type StageName,
  type RecoveryKind,
  type TransitionVerdict,
  type StageTransitionInput,
  type RecoveryTransitionInput,
  type IntakeTransitionInput,
} from "./greenfield-state-machine.js";

export {
  GreenfieldOrchestrator,
  type StageRunners,
  type StageRunnerContext,
  type PersonaDoc,
  type TickResult,
} from "./greenfield-orchestrator.js";

export { GreenfieldRecovery, type ApplyRecoveryInput, type ApplyRecoveryResult } from "./greenfield-recovery.js";

export { GreenfieldStageSeeder } from "./greenfield-stage-seeder.js";
