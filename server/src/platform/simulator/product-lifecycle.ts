// Product-lifecycle simulator (TC-PRODUCT-01..10).
// Deterministic in-memory model of the FCTCAI production system over simulated days.
// Stitches the pieces — workspaces, missions, sprints, brain insights, gates, budget
// pools, brier scores, agent pool — into one state machine so tests can run multi-week
// scenarios without standing up Postgres or wall-clock wait. Production code is unaffected.

export type WorkspaceStatus = "active" | "paused" | "archived" | "deleted";
export type MissionStatus = "pending" | "running" | "blocked" | "done" | "killed";
export type GateOutcome = "approved" | "rejected" | "delegated" | "auto_approved";

export interface WorkspaceConfig {
  id: string;
  name: string;
  weight: number;
  weeklyBudgetUsd: number;
  founderWeeklyHours: number;
}

export interface MissionRecord {
  id: string;
  workspaceId: string;
  status: MissionStatus;
  createdDay: number;
  completedDay: number | null;
  costUsd: number;
  brierScore: number;
  featureShipped: boolean;
  cancelled: boolean;
}

export interface GateRecord {
  workspaceId: string;
  missionId: string;
  day: number;
  outcome: GateOutcome;
  founderTimeMinutes: number;
}

export interface BrainInsight {
  workspaceId: string;
  topic: string;
  superseded: boolean;
}

export interface SagaRecord {
  scope: string[];
  status: "running" | "rolled_back" | "completed";
  affectedWorkspaceIds: string[];
}

export interface KPISnapshot {
  workspaceId: string;
  gatesPerWeek: number;
  founderHoursPerWeek: number;
  featuresShippedTotal: number;
  averageBrier: number;
  uptimeDays: number;
  budgetSpentUsd: number;
  budgetCapUsd: number;
}

export interface Notification {
  channel: "pagerduty" | "email" | "slack" | "in_app";
  severity: "info" | "warning" | "critical";
  title: string;
  workspaceId: string | null;
  day: number;
}

interface BudgetState {
  capUsd: number;
  spentUsd: number;
  pausedNonCritical: boolean;
}

export interface SimulatorOptions {
  initialDay?: number;
  agentPoolSize?: number;
  founderAbsentUntilDay?: number | null;
}

export class ProductLifecycleSimulator {
  private day = 0;
  private nextMissionSeq = 0;
  private nextSagaSeq = 0;

  private readonly workspaces = new Map<string, WorkspaceConfig & { status: WorkspaceStatus }>();
  private readonly budgets = new Map<string, BudgetState>();
  public readonly missions: MissionRecord[] = [];
  public readonly gates: GateRecord[] = [];
  public readonly insights: BrainInsight[] = [];
  public readonly sagas: SagaRecord[] = [];
  public readonly notifications: Notification[] = [];
  public readonly heapSnapshots: { day: number; bytes: number }[] = [];
  public readonly cronExecutionLog: { day: number; cron: string }[] = [];
  public agentPoolSize: number;
  public founderAbsentUntilDay: number | null;

  constructor(opts: SimulatorOptions = {}) {
    this.day = opts.initialDay ?? 0;
    this.agentPoolSize = opts.agentPoolSize ?? 5;
    this.founderAbsentUntilDay = opts.founderAbsentUntilDay ?? null;
  }

  // -- Workspace ops -------------------------------------------------------

  createWorkspace(cfg: WorkspaceConfig): void {
    if (this.workspaces.has(cfg.id)) throw new Error(`workspace ${cfg.id} exists`);
    this.workspaces.set(cfg.id, { ...cfg, status: "active" });
    this.budgets.set(cfg.id, { capUsd: cfg.weeklyBudgetUsd, spentUsd: 0, pausedNonCritical: false });
  }

  archiveWorkspace(id: string): void {
    const w = this.requireWorkspace(id);
    w.status = "archived";
    // archive auto-blocks running missions
    for (const m of this.missions) {
      if (m.workspaceId === id && (m.status === "running" || m.status === "pending")) {
        m.status = "blocked";
      }
    }
  }

  deleteWorkspace(id: string): { auditPreserved: boolean; orphaned: number } {
    const w = this.requireWorkspace(id);
    if (w.status !== "archived") throw new Error(`must archive before delete: ${id}`);
    const orphaned = this.missions.filter(
      (m) => m.workspaceId === id && m.status !== "done" && !m.cancelled,
    ).length;
    w.status = "deleted";
    // audit preserved: we keep records (gates, missions) but flip workspace status.
    return { auditPreserved: true, orphaned };
  }

  pauseNonCriticalForBudget(id: string): void {
    const b = this.budgets.get(id);
    if (!b) return;
    b.pausedNonCritical = true;
    for (const m of this.missions) {
      if (m.workspaceId === id && m.status === "running") {
        m.status = "blocked";
      }
    }
  }

  reallocateBudget(fromId: string, toId: string, amountUsd: number): void {
    const f = this.budgets.get(fromId);
    const t = this.budgets.get(toId);
    if (!f || !t) throw new Error("invalid workspace for reallocation");
    if (f.capUsd - amountUsd < f.spentUsd) throw new Error("cannot reduce below spent");
    f.capUsd -= amountUsd;
    t.capUsd += amountUsd;
  }

  // -- Mission ops ---------------------------------------------------------

  spawnMission(workspaceId: string, opts?: { brier?: number; cost?: number; ship?: boolean }): MissionRecord {
    const w = this.requireWorkspace(workspaceId);
    if (w.status !== "active") throw new Error(`workspace not active: ${workspaceId}`);
    const m: MissionRecord = {
      id: `m_${++this.nextMissionSeq}`,
      workspaceId,
      status: "pending",
      createdDay: this.day,
      completedDay: null,
      costUsd: 0,
      brierScore: opts?.brier ?? 0.12,
      featureShipped: opts?.ship ?? false,
      cancelled: false,
    };
    m.costUsd = opts?.cost ?? 5;
    this.missions.push(m);
    return m;
  }

  cancelMission(id: string, reason: string): void {
    const m = this.missions.find((x) => x.id === id);
    if (!m) return;
    m.cancelled = true;
    m.status = "killed";
    this.notifications.push({
      channel: "in_app",
      severity: "info",
      title: `mission ${id} cancelled — ${reason}`,
      workspaceId: m.workspaceId,
      day: this.day,
    });
  }

  // -- Gate ops ------------------------------------------------------------

  recordGate(workspaceId: string, missionId: string, outcome: GateOutcome, founderMin: number): void {
    this.gates.push({ workspaceId, missionId, day: this.day, outcome, founderTimeMinutes: founderMin });
  }

  // -- Brain ---------------------------------------------------------------

  addInsight(workspaceId: string, topic: string): void {
    this.insights.push({ workspaceId, topic, superseded: false });
  }

  supersedeInsights(workspaceId: string, topicPrefix: string): number {
    let n = 0;
    for (const i of this.insights) {
      if (i.workspaceId === workspaceId && i.topic.startsWith(topicPrefix) && !i.superseded) {
        i.superseded = true;
        n++;
      }
    }
    return n;
  }

  // -- Saga ----------------------------------------------------------------

  triggerSaga(scope: string[], affectedWorkspaceIds: string[]): SagaRecord {
    const s: SagaRecord = {
      scope: [`saga_${++this.nextSagaSeq}`, ...scope],
      status: "running",
      affectedWorkspaceIds,
    };
    this.sagas.push(s);
    return s;
  }

  rollbackSaga(scopeId: string): void {
    const s = this.sagas.find((x) => x.scope[0] === scopeId);
    if (!s) return;
    s.status = "rolled_back";
  }

  // -- Time advance --------------------------------------------------------

  advanceDays(n: number): void {
    for (let i = 0; i < n; i++) {
      this.day++;
      this.runDailyTick();
    }
  }

  private runDailyTick(): void {
    this.cronExecutionLog.push({ day: this.day, cron: "daily_tick" });

    // weekly heap snapshot + budget reset
    if (this.day % 7 === 0) {
      this.heapSnapshots.push({ day: this.day, bytes: 80_000_000 + (this.day * 1000) });
      for (const [, b] of this.budgets) b.spentUsd = 0;
    }

    // execute pending missions if agent pool not exhausted and workspace active.
    let slots = this.agentPoolSize;
    for (const w of this.activeWorkspaces()) {
      const b = this.budgets.get(w.id);
      if (!b || b.pausedNonCritical) continue;
      const queue = this.missions.filter((m) => m.workspaceId === w.id && m.status === "pending");
      const share = Math.max(1, Math.floor(slots * (w.weight / this.weightsTotal())));
      let taken = 0;
      for (const m of queue) {
        if (taken >= share) break;
        if (b.spentUsd + m.costUsd > b.capUsd) break;
        m.status = "running";
        b.spentUsd += m.costUsd;
        taken++;
      }
      slots -= taken;
    }

    // complete running missions next tick
    for (const m of this.missions) {
      if (m.status === "running") {
        m.status = "done";
        m.completedDay = this.day;
      }
    }

    // founder absence escalation batching
    if (this.founderAbsentUntilDay !== null && this.day <= this.founderAbsentUntilDay) {
      const overdueGates = this.gates.filter((g) => this.day - g.day >= 3 && g.outcome === "delegated");
      if (overdueGates.length > 5) {
        this.notifications.push({
          channel: "email",
          severity: "warning",
          title: `${overdueGates.length} gates pending — founder absent`,
          workspaceId: null,
          day: this.day,
        });
      }
    }
  }

  // -- Reporting -----------------------------------------------------------

  snapshotKPI(workspaceId: string, weekWindow = 7): KPISnapshot {
    const w = this.requireWorkspace(workspaceId);
    const since = Math.max(0, this.day - weekWindow);
    const gates = this.gates.filter((g) => g.workspaceId === workspaceId && g.day >= since);
    const founderMinutes = gates.reduce((s, g) => s + g.founderTimeMinutes, 0);
    const wsMissions = this.missions.filter((m) => m.workspaceId === workspaceId);
    const features = wsMissions.filter((m) => m.featureShipped && m.status === "done").length;
    const brier =
      wsMissions.length > 0
        ? wsMissions.reduce((s, m) => s + m.brierScore, 0) / wsMissions.length
        : 0;
    const b = this.budgets.get(workspaceId)!;
    return {
      workspaceId,
      gatesPerWeek: gates.length,
      founderHoursPerWeek: founderMinutes / 60,
      featuresShippedTotal: features,
      averageBrier: brier,
      uptimeDays: this.day,
      budgetSpentUsd: b.spentUsd,
      budgetCapUsd: b.capUsd,
    };
  }

  currentDay(): number {
    return this.day;
  }

  workspaceStatus(id: string): WorkspaceStatus {
    return this.requireWorkspace(id).status;
  }

  // -- Helpers -------------------------------------------------------------

  private activeWorkspaces() {
    return Array.from(this.workspaces.values()).filter((w) => w.status === "active");
  }

  private weightsTotal() {
    return this.activeWorkspaces().reduce((s, w) => s + w.weight, 0) || 1;
  }

  private requireWorkspace(id: string) {
    const w = this.workspaces.get(id);
    if (!w) throw new Error(`workspace not found: ${id}`);
    return w;
  }
}
