---
tags: [architecture, autonomy, self-healing, liveness, design]
date: 2026-04-29
priority: P0
---

# Self-Healing & Liveness Design

> **Mục đích:** Đảm bảo Paperclip tự phát hiện và recover khỏi stuck workflows, deadlocks, infinite loops, runaway costs — không yêu cầu human babysit dashboard.

---

## 1. Vấn đề

Trong autonomous system, "happy path" chiếm ~85% thời gian. 15% còn lại là edge cases có thể làm system stuck:

| Failure mode | Triệu chứng | Hậu quả |
|--------------|------------|---------|
| Stalled task | Agent chạy nhưng không emit progress | Block workflow, đốt budget |
| Infinite loop | Agent gọi tool → phản hồi sai → retry vô hạn | Cost runaway, block dependent tasks |
| Deadlock | Agent A đợi B, B đợi A | Cả 2 stuck, no progress |
| Cost runaway | Agent đúng flow nhưng tốn $$$ bất thường | Budget burst |
| Tool timeout cascade | MCP down → mọi agent retry → spike load | System-wide slowdown |
| State corruption | Checkpoint inconsistent | Wrong decisions downstream |
| Zombie agent | Agent process còn nhưng không respond | Block scheduler slot |

**Yêu cầu SLA:**
- Detect ≤ 5 phút sau khi xảy ra
- Auto-recover ≤ 3 phút
- Escalate to human ≤ 1 phút sau khi auto-recover thất bại

---

## 2. Liveness Architecture

### 2.1 Heartbeat Protocol

Mọi long-running agent phải emit heartbeat:

```typescript
interface Heartbeat {
  workflow_id: string;
  task_id: string;
  agent_id: string;
  timestamp: Date;
  state: 'thinking' | 'tool_calling' | 'waiting' | 'progressing' | 'idle';
  progress_marker?: string;       // "step 3 of 8: writing tests"
  cost_so_far_usd: number;
  tokens_so_far: number;
  current_tool?: string;          // tool name if state='tool_calling'
  waiting_on?: string;            // task_id if state='waiting'
}
```

**Frequency:**
- Active state: every 30s
- Tool-calling state: every 5s
- Idle state: every 2 min

### 2.2 Watchdog Service

Cron task chạy mỗi 60s:

```typescript
async function watchdogTick() {
  const stuckCandidates = await db.query(`
    SELECT workflow_id, task_id, agent_id, last_heartbeat, state, current_tool, waiting_on
    FROM liveness_heartbeats
    WHERE NOW() - last_heartbeat > INTERVAL '5 minutes'
      AND status = 'active'
  `);

  for (const c of stuckCandidates) {
    const diagnosis = await diagnose(c);
    await handleStuck(c, diagnosis);
  }

  await checkCostRunaway();
  await checkDeadlockGraph();
  await checkMcpHealth();
}
```

### 2.3 Diagnosis Decision Tree

```
Heartbeat absent > 5min?
├── Process alive?
│   ├── No → CRASHED → restart from last checkpoint
│   └── Yes → check tool_calls log
│       ├── Same tool > 10x in 5min, similar args → INFINITE_LOOP → kill + escalate
│       ├── Tool waiting > 2min → TOOL_STUCK → cancel tool, retry once
│       └── No recent tool calls → AGENT_STALLED → inject "ping" prompt
├── Cost > 2x estimate? → COST_RUNAWAY → pause + escalate
└── Waiting_on points to another waiting agent → DEADLOCK → kill both, restart with priority
```

---

## 3. Stuck Detection — Concrete Rules

### Rule 1: Stalled Task

```
Trigger:  NO heartbeat for 5min AND status='active'
Action 1: Send "ping" message to agent (request progress)
Wait:     2 min
Action 2: If still silent → kill + auto-restart from checkpoint (max 1 restart)
Action 3: If 2nd restart also stalls → escalate
```

### Rule 2: Infinite Loop

```
Trigger:  SAME tool name + similar args (cosine sim ≥ 0.9) called > 10 times in 5min
Action:   Kill immediately
Capture:  Last 50 tool calls + LLM input/output as evidence
Escalate: Mandatory (with diagnosis report)
```

### Rule 3: Deadlock

```
Trigger:  Agent A.waiting_on = Task_B AND Agent B.waiting_on = Task_A
          (or chain: A→B→C→A)
Action:   Kill all agents in cycle
Restart:  Resume with priority hint to lowest task_id first
Escalate: If deadlock recurs after 1 retry
```

### Rule 4: Cost Runaway

```
Trigger:  task.cost_so_far > task.estimated_cost * 2.0  (floor: $5)
Action:   Pause + snapshot state
Escalate: Immediate (no auto-resume)
Refund:   Unused budget returned to project pool
```

### Rule 5: Tool Timeout Cascade

```
Trigger:  > 5 agents got tool timeout from same MCP in 60s
Action:   Enable circuit breaker on that MCP (skip + queue for retry)
Recovery: Health probe every 30s, close breaker when 3 consecutive successes
Escalate: If MCP down > 10min → notify ops via PagerDuty
```

### Rule 6: State Corruption

```
Trigger:  Checkpoint deserialize error OR invariant violation on resume
Action:   Restore from previous checkpoint (max 3 generations back)
Escalate: If all 3 corrupted → halt workflow + page ops
```

### Rule 7: Drag-in Detection (passive) — Sync #4

```
Trigger:  Any of:
  - Human edits files in workspace path outside agent commit (git author != agent)
  - Human runs >5min CLI session in workspace dir without agent task active
  - Human posts /dragin command (active marker)
  - Approval queue has > workspace.gate_quota_per_week items pending > 24h
  - Mission requires manual TC fallback > 3 times in 7d
  - **Intake volume per week > 2× gate_quota_per_week** (human-driven intake overload — see [[Human-Intake-and-Solution-Loop-Design]] §10.1)
  - **Same intake submitter creates >5 intakes/week against same workspace** (signals workspace doesn't self-serve well enough)
Action:   Emit `human_drag_in_event` (no kill, observation only)
Schema:
  CREATE TABLE human_drag_in_events (
    id UUID PRIMARY KEY,
    workspace_id TEXT,
    kind TEXT,              -- 'silent_edit' | 'cli_session' | 'manual_/dragin' | 'queue_overflow' | 'manual_tc_overflow' | 'intake_volume' | 'submitter_repeat'
    minutes_estimated NUMERIC,
    intake_id UUID REFERENCES intake_items(id),  -- NULL except for intake-derived kinds
    occurred_at TIMESTAMPTZ DEFAULT now()
  );
Aggregate: Weekly digest per workspace; if total > 2× gate_quota_per_week → critical approval "autonomy regression" (Decide pattern).
  - For `intake_volume` kind: payload includes top-3 intake categories (problem/feature_request/bug_report/etc.) so Strategic Loop knows WHERE the regression is; emits `strategic_input` intake auto-suggesting "should we adjust workspace autonomy template?"
```

→ Drag-in is the **goal-achievement metric**: human time spent OUTSIDE the gate-approve role. Target ≤ 0 per week (only gates count).

---

## 4. Auto-Recovery Action Matrix

| Failure | First action | Retry? | Max retries | Escalate after |
|---------|--------------|--------|-------------|----------------|
| Stalled | Ping agent | Yes | 1 | 8 min total silence |
| Infinite loop | Kill + report | No | 0 | Immediate |
| Deadlock | Kill cycle, priority restart | Yes | 1 | If recurs |
| Cost runaway | Pause + snapshot | No | 0 | Immediate |
| MCP cascade | Circuit break | Auto-backoff | ∞ | If down > 10 min |
| State corruption | Restore prev checkpoint | Yes | 3 generations | If all bad |
| Crashed process | Restart from checkpoint | Yes | 2 | If 3rd crash in 1h |
| Zombie | SIGTERM → SIGKILL | Yes | 1 | If reappears |

---

## 5. Kill Switch — Human Override

### 5.1 Kill Levels

| Level | Scope | Use case |
|-------|-------|----------|
| `task` | 1 task | Cost too high, wrong direction |
| `workflow` | Full workflow + dependent tasks | Major design error realized late |
| `agent` | All tasks of one agent globally | Agent misbehaving |
| `project` | All workflows of project | Pause project entirely |
| `global` | Everything | Emergency stop (security incident) |

### 5.2 Kill API

```typescript
POST /api/kill
Body: {
  level: 'task' | 'workflow' | 'agent' | 'project' | 'global',
  target_id: string,
  reason: string,                  // mandatory for audit
  preserve_checkpoint: boolean,    // resumable later?
  refund_budget: boolean
}

Response: {
  killed_count: number,
  preserved_checkpoints: string[],
  estimated_refund_usd: number,
  affected_workflows: string[]
}
```

### 5.3 Kill UX

- **Approval Center sidebar**: red "🛑 STOP" button per task/workflow
- **Mobile**: long-press card → kill menu
- **Confirmation modal mandatory** for `workflow`+ levels with reason text
- **Audit log**: every kill event written to `kill_events`, visible in `/admin/audit`

### 5.4 Resume from killed

If `preserve_checkpoint: true`:
- Checkpoint kept in `paused_workflows` table
- Human can re-trigger via "Resume" button → workflow continues from last checkpoint
- Resume also writes to `decision_log` for traceability

---

## 6. Database Schema

```sql
CREATE TABLE liveness_heartbeats (
  id BIGSERIAL PRIMARY KEY,
  workflow_id UUID NOT NULL,
  task_id UUID NOT NULL,
  agent_id TEXT NOT NULL,
  state TEXT NOT NULL,
  progress_marker TEXT,
  cost_so_far_usd NUMERIC(10,4),
  tokens_so_far INT,
  current_tool TEXT,
  waiting_on UUID,
  status TEXT NOT NULL,        -- active, completed, killed, errored, paused
  last_heartbeat TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_heartbeats_active ON liveness_heartbeats (status, last_heartbeat)
  WHERE status='active';
CREATE INDEX idx_heartbeats_waiting ON liveness_heartbeats (waiting_on)
  WHERE waiting_on IS NOT NULL;

CREATE TABLE stuck_events (
  id BIGSERIAL PRIMARY KEY,
  workflow_id UUID NOT NULL,
  task_id UUID,
  agent_id TEXT,
  failure_mode TEXT NOT NULL,  -- stalled, infinite_loop, deadlock, cost_runaway, mcp_cascade, corruption, zombie
  detected_at TIMESTAMPTZ NOT NULL,
  diagnosis JSONB NOT NULL,
  evidence JSONB,              -- tool calls, prompts, etc.
  auto_action_taken TEXT,
  auto_action_result TEXT,     -- success, failed, escalated
  escalated_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT
);

CREATE TABLE kill_events (
  id BIGSERIAL PRIMARY KEY,
  level TEXT NOT NULL,
  target_id TEXT NOT NULL,
  triggered_by TEXT NOT NULL,  -- user_id OR 'auto:<rule_name>'
  reason TEXT NOT NULL,
  preserve_checkpoint BOOLEAN,
  killed_count INT,
  refund_usd NUMERIC(10,2),
  affected_workflows UUID[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE workflow_health (
  workflow_id UUID PRIMARY KEY,
  health_score INT NOT NULL,   -- 0-100
  active_alerts INT DEFAULT 0,
  last_assessed TIMESTAMPTZ,
  composite_state TEXT,        -- healthy, degraded, stuck, recovering
  diagnostics JSONB
);

CREATE TABLE paused_workflows (
  workflow_id UUID PRIMARY KEY,
  paused_at TIMESTAMPTZ,
  paused_by TEXT,
  checkpoint_ref TEXT,
  reason TEXT,
  resume_eligible BOOLEAN DEFAULT TRUE,
  resumed_at TIMESTAMPTZ
);
```

---

## 7. Health Score Computation

`workflow_health.health_score` (0-100), updated every 60s:

```python
def compute_health_score(workflow_id):
    score = 100
    if has_active_stuck_event(workflow_id):  score -= 40
    if cost_ratio(workflow_id) > 1.5:        score -= 20
    if any_tasks_paused(workflow_id):         score -= 15
    if recent_restart_count(workflow_id) > 0: score -= 10 * count
    if mcp_circuit_open_affects(workflow_id): score -= 15
    return max(0, score)
```

| Score | State | UI signal |
|-------|-------|-----------|
| 90-100 | healthy | green dot |
| 70-89 | minor issues | yellow dot |
| 40-69 | degraded | orange + alert |
| 0-39 | stuck/critical | red + push notification |

---

## 8. UX Surfaces

### Command Center widget
```
┌─────────────────────────────────────┐
│ System Health                       │
│ ████████████████░░░  87/100        │
│ 23 workflows healthy                │
│ 2 degraded · 0 stuck                │
│ [View health log]                   │
└─────────────────────────────────────┘
```

### Stuck event list (admin)
```
🛑 Stuck Events (last 7d)
─────────────────────────────────────
Apr 28 14:23  cost_runaway   workflow #4521
              auto-paused, $42 refund
              [Diagnose] [Resume]

Apr 27 09:11  deadlock       workflows #4500, #4501
              auto-resolved (priority restart)
              [View evidence]
```

### Kill confirmation modal
```
┌────────────────────────────────────┐
│ ⚠️ Stop Workflow #4521              │
│ "Auth refactor sprint 12"           │
│                                      │
│ This will:                          │
│ • Stop 3 active tasks               │
│ • Refund ~$8 unused budget          │
│ • Preserve checkpoint for resume    │
│                                      │
│ Reason (required):                  │
│ [textarea]                          │
│                                      │
│ [Cancel]   [🛑 Stop & Preserve]    │
└────────────────────────────────────┘
```

---

## 9. Implementation Roadmap

### Phase 0 — Heartbeat Foundation (2 days)
- [ ] `liveness_heartbeats` table + indexes
- [ ] Heartbeat emit hook in agent base class
- [ ] Heartbeat ingestion endpoint + batching

### Phase 1 — Watchdog (3 days)
- [ ] Cron job (60s tick)
- [ ] Diagnosis decision tree
- [ ] `stuck_events` table + writer

### Phase 2 — Auto-Recovery (3 days)
- [ ] Kill task/workflow primitives
- [ ] Restart from checkpoint flow
- [ ] Recovery action matrix wiring
- [ ] Cost runaway detector

### Phase 3 — Deadlock & MCP (2 days)
- [ ] Wait-graph cycle detection
- [ ] MCP circuit breaker registry
- [ ] Health probe scheduler

### Phase 4 — Kill Switch UX (2 days)
- [ ] Kill API endpoints
- [ ] Approval Center kill button + confirmation modal
- [ ] Mobile long-press menu
- [ ] Audit log viewer

### Phase 5 — Health Dashboard (2 days)
- [ ] `workflow_health` aggregator
- [ ] Health score in Command Center
- [ ] Stuck event log viewer
- [ ] Resume from paused workflow flow

---

## 10. Liên kết

- [[Autonomous-PM-Strategic-Loop-Design#12. Emergency Circuit Breaker]] — extended with stuck detection
- [[Autonomous-Operations-and-Human-Gate-Design#9. Notification Routing]] — escalation channels
- [[Decision-Boundary-and-Uncertainty-Model]] — decision log informs stuck diagnosis
- [[UX-Strategy-and-Design#5. Screen Designs]] — Health widget placement
