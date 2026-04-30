// Top-level façade for the Platform layer.
// Composes AgentPool / SkillLibrary / ToolRegistry / WorkspaceContextStore / CostAttributor
// behind one handle so missions only depend on `Platform`, not its internals.
// Per Phase-2-Platform-Workspace-Mission-Layer §2.1.

import type { Db } from "@paperclipai/db";
import { AgentPool } from "./agent-pool.js";
import { SkillLibrary } from "./skill-library.js";
import { ToolRegistry } from "./tool-registry.js";
import { WorkspaceContextStore } from "./workspace-context.js";
import { CostAttributor } from "./cost-attributor.js";
import { ApprovalRouter } from "./autonomy/approval-router.js";
import { AutonomyGate } from "./autonomy/autonomy-gate.js";
import { BrainStore } from "./strategic-loop/brain-store.js";
import { HeartbeatStore } from "./self-healing/heartbeat-store.js";
import { KillSwitch } from "./self-healing/kill-switch.js";
import { Watchdog } from "./self-healing/watchdog.js";

export class Platform {
  readonly agents: AgentPool;
  readonly skills: SkillLibrary;
  readonly tools: ToolRegistry;
  readonly workspaces: WorkspaceContextStore;
  readonly cost: CostAttributor;
  readonly approvals: ApprovalRouter;
  readonly autonomyGate: AutonomyGate;
  readonly brain: BrainStore;
  readonly heartbeats: HeartbeatStore;
  readonly killSwitch: KillSwitch;
  readonly watchdog: Watchdog;

  constructor(db: Db) {
    this.agents = new AgentPool(db);
    this.skills = new SkillLibrary(db);
    this.tools = new ToolRegistry(db);
    this.workspaces = new WorkspaceContextStore(db);
    this.cost = new CostAttributor(db);
    this.approvals = new ApprovalRouter(db);
    this.autonomyGate = new AutonomyGate();
    this.brain = new BrainStore(db);
    this.heartbeats = new HeartbeatStore(db);
    this.killSwitch = new KillSwitch(db);
    this.watchdog = new Watchdog(db, this.killSwitch);
  }
}

export type {
  PlatformAgentRecord,
} from "./agent-pool.js";
export type { SkillResolution } from "./skill-library.js";
export type { RegisteredTool } from "./tool-registry.js";
export type { WorkspaceContext, AutonomyLevel } from "./workspace-context.js";
export type { CostEventInput, RecordCostResult } from "./cost-attributor.js";
export { hashWorkspaceToBucket } from "./skill-library.js";
export { WfqScheduler } from "./wfq-scheduler.js";
export type { WfqJob, WfqDispatchPlan } from "./wfq-scheduler.js";
export type {
  GateInput,
  GateResult,
  GateDecision,
  CapabilityMode,
} from "./autonomy/autonomy-gate.js";
export type {
  ProposalPayload,
  ProposalPatternKey,
} from "./autonomy/proposal-patterns.js";
export type { RouteApprovalInput, RouteApprovalResult } from "./autonomy/approval-router.js";
export type { Brain, InsightInput } from "./strategic-loop/brain-store.js";
export {
  canTransition,
  isTerminal,
  legalRunnerTargets,
  legalUserTargets,
} from "./strategic-loop/mission-state-machine.js";
export type {
  Actor,
  MissionStatus,
  TransitionInput,
  TransitionVerdict,
} from "./strategic-loop/mission-state-machine.js";
export { MissionRunner } from "./strategic-loop/mission-runner.js";
export type {
  TickReport,
  PlanningSeed,
  ReflectorSignal,
  MissionRunnerDeps,
} from "./strategic-loop/mission-runner.js";
