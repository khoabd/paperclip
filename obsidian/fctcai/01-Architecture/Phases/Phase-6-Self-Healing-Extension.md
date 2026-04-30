# Phase 6 — Self-Healing Extension

**Status:** done (Apr 29)
**Owner:** Khoa
**Depends on:** Phase 2 (workspace primitives, cost), Phase 3 (autonomy gate), Phase 4 (mission state machine), Phase 5 (intake-derived drag-in kinds)
**Anchors:** [[../Self-Healing-and-Liveness-Design]] · [[../Master-Architecture-Overview]]
**Master plan:** [[../Implementation-Master-Plan#Phase 6]]

## Goal

Detect and recover from stuck missions automatically. Live heartbeats every 10–30s, watchdog with 7 stuck rules, composite health score per workspace, kill switch with 5 levels. Gate criteria: inject a stalled mission (no heartbeat 5 min) → watchdog detects → emits `stuck_event` → auto-recovery attempt or human gate.

## Non-goals (deferred)

- PagerDuty / external notification escalation — Phase 7 (after webhook hardening).
- UI widgets (health score, kill modal) — Phase 15.
- Drag-in volume telemetry beyond emit (clustering / digest) — Phase 10.
- Distributed-tracing for stuck diagnosis — Phase 14b.

## §6.1 Schema additions

Numbering follows Phase 5 (last migration `0103`).

`0104_liveness_heartbeats.sql`
```
liveness_heartbeats
 - id uuid pk default gen_random_uuid()
 - mission_id uuid not null fk missions (cascade)
 - mission_step_id uuid fk mission_steps (set null)
 - agent_id uuid fk agents (set null)
 - state text not null                       -- active|completed|killed|errored|paused
 - progress_marker text
 - cost_so_far_usd numeric(12,6)
 - tokens_so_far integer
 - current_tool text
 - waiting_on uuid
 - sent_at timestamptz default now()
 - index (mission_id, sent_at)
 - partial index (state, sent_at) WHERE state = 'active'
```

`0105_stuck_events.sql`
```
stuck_events
 - id uuid pk
 - company_id uuid not null fk companies (cascade)
 - mission_id uuid fk missions (set null)
 - mission_step_id uuid fk mission_steps (set null)
 - rule text not null                        -- stalled|infinite_loop|deadlock|cost_runaway|mcp_cascade|state_corruption|drag_in
 - detected_at timestamptz default now()
 - diagnosis jsonb default '{}'
 - evidence jsonb default '{}'
 - auto_action text
 - auto_action_result text                   -- success|failed|escalated
 - resolved_at timestamptz
 - resolution_notes text
 - index (company_id, rule, detected_at)
 - partial index (resolved_at) WHERE resolved_at IS NULL
```

`0106_kill_events.sql`
```
kill_events
 - id uuid pk
 - company_id uuid fk companies (set null)
 - level text not null                       -- task|workflow|agent|workspace|global
 - target_id text not null
 - triggered_by text not null                -- user:<id> | auto:<rule>
 - reason text not null
 - preserve_checkpoint boolean default true
 - killed_count integer default 0
 - refund_usd numeric(12,4)
 - affected_mission_ids uuid[] default '{}'::uuid[]
 - occurred_at timestamptz default now()
 - index (company_id, occurred_at)
```

`0107_workflow_health.sql`
```
workflow_health
 - id uuid pk
 - company_id uuid not null fk companies (cascade)
 - mission_id uuid fk missions (cascade)     -- nullable for workspace-level rollups
 - score integer not null                    -- 0-100
 - composite_state text not null             -- healthy|minor|degraded|critical
 - active_alerts integer default 0
 - diagnostics jsonb default '{}'
 - computed_at timestamptz default now()
 - unique (company_id, mission_id)
 - index (company_id, composite_state)
```

`0108_human_drag_in_events.sql`
```
human_drag_in_events
 - id uuid pk
 - company_id uuid not null fk companies (cascade)
 - kind text not null                        -- silent_edit|cli_session|manual_dragin|queue_overflow|manual_tc_overflow|intake_volume|submitter_repeat
 - minutes_estimated numeric(8,2)
 - intake_id uuid fk intake_items (set null)
 - actor_user_id text
 - payload jsonb default '{}'
 - occurred_at timestamptz default now()
 - index (company_id, kind, occurred_at)
```

## §6.2 Services

`server/src/platform/self-healing/`
```
heartbeat-emitter.ts     publish(missionId, agentId, state, progress, cost, tokens, currentTool, waitingOn)
heartbeat-store.ts       latest(missionId), recent(missionId, lookbackMin), activeWith(noPingForMin)
watchdog.ts              7 rules, returns array<StuckEvent> + applies auto-action
health-scorer.ts         compute(workspaceId | missionId) → score 0-100 + composite_state
kill-switch.ts           5 levels (task | workflow | agent | workspace | global). Persists, optionally pauses missions.
__tests__/
  watchdog-rules.test.ts            unit (pure rule evaluation against synthetic ctx)
  health-scorer.test.ts             unit
  heartbeat-store.integration.test.ts
  watchdog.integration.test.ts      stalled-mission E2E (gate criteria)
  kill-switch.integration.test.ts   level-cascade + audit row
```

### Watchdog rules

Each rule is a pure function: `(ctx: WatchdogCtx) → StuckEvent | null`. The runner loads the per-mission ctx (latest heartbeat, recent tool calls, cost stats, intake-volume aggregate) and evaluates all 7 rules.

| # | Rule | Trigger |
| --- | --- | --- |
| 1 | `stalled` | `now - lastHeartbeat > 5min` AND `state = 'active'` |
| 2 | `infinite_loop` | Same `current_tool` ≥ 10 times in last 5 min on the same mission |
| 3 | `deadlock` | Cycle in `waiting_on` graph (A→B→A or A→B→C→A) |
| 4 | `cost_runaway` | `cost_so_far_usd > predictedCost × 2` AND > $5 |
| 5 | `mcp_cascade` | ≥ 5 missions report `current_tool` matching same MCP key with no progress in last 60s |
| 6 | `state_corruption` | `state = 'errored'` AND `progress_marker LIKE 'invariant_violation%'` |
| 7 | `drag_in` | Aggregator: > workspace.gate_quota_per_week pending approvals > 24h, or `intake_volume` flag from Phase 5, or queue overflow |

For Mile-A this phase ships rules **1-4 + 7 (intake-derived drag-in)** with full recovery; rules 5 and 6 land as **detection-only** stubs with `auto_action='detect_only'` (no kill) and an explicit TODO. Phase 14b adds the chaos-test harness.

### Auto-action matrix (Mile-A subset)

| Rule | First action | Retry | Escalate after |
| --- | --- | --- | --- |
| stalled | ping + wait 2 min | 1 restart | 8 min total silence |
| infinite_loop | kill mission immediately | 0 | always escalate |
| deadlock | kill cycle, lowest mission_id resumes first | 1 | 2nd cycle |
| cost_runaway | pause + snapshot, no auto-resume | 0 | always escalate |
| drag_in | emit observation only (no kill) | n/a | weekly digest |

Mid-Phase 6 the runner only writes `stuck_events`; the actual mission-kill side calls into `KillSwitch.apply()` via `auto:<rule>` so the audit trail is unified.

### Health Score

Per-mission rollup:
```
score = 100
  − 40 if has_active_stuck_event
  − 20 if cost_ratio > 1.5
  − 15 if recent_kill_event_30min
  − 10 × restart_count
  − 15 if mcp_cascade_open
score = max(0, score)
state = score >= 90 ? healthy : score >= 70 ? minor : score >= 40 ? degraded : critical
```

Workspace rollup = average across active missions, plus −5 per active drag-in event in last 7 days.

### Kill Switch levels

| Level | Scope | Applied side-effect |
| --- | --- | --- |
| `task` | One `mission_step` | Mark step `failed`; runner picks up next step |
| `workflow` | One `mission` | Mission → `blocked`; preserves checkpoint by default |
| `agent` | All running missions of an `agent_id` | Each affected mission → `blocked` |
| `workspace` | All running missions in `company_id` | Each → `blocked`; freeze workspace status to `paused` |
| `global` | Everything across all workspaces | Each → `blocked`; emits a `kill_event` per workspace touched |

Each invocation writes one `kill_events` row. The runner records `affected_mission_ids` for audit. `preserve_checkpoint=true` is the default; setting it false also clears intermediate state on the mission's `state_payload` (but never deletes the mission row itself).

## §6.3 APIs

```
POST   /api/missions/:id/heartbeat                { state, progressMarker?, cost?, tokens?, currentTool?, waitingOn? }
GET    /api/companies/:id/health-score
GET    /api/companies/:id/stuck-events            optional rule, limit
POST   /api/kill                                   { level, targetId, reason, preserveCheckpoint?, refundBudget? }
```

Routes are wired in Phase 7 (HTTP surface phase). Phase 6 ships the service layer + the cron-driven watchdog runner.

## §6.4 Cron / runner

`server/src/platform/self-healing/watchdog-runner.ts` exports a `runOnce(opts)` that:
1. Loads `liveness_heartbeats` newer than now-15min plus mission rows in `executing` status.
2. For each mission, builds a `WatchdogCtx` and evaluates the 7 rules.
3. Persists `stuck_events`, fires `KillSwitch.apply()` for kill rules, recomputes `workflow_health`.

The actual cron schedule is wired in Phase 7 (heartbeat scheduler). Phase 6 only requires `runOnce` to be deterministic and idempotent so tests can call it directly.

## §6.5 Tests

| Test | Layer | What it proves |
| --- | --- | --- |
| `watchdog-rules.test.ts` | unit | 4 active rules + 1 intake-derived rule fire on synthetic ctx; 5/6 stay quiet |
| `health-scorer.test.ts` | unit | Composite state thresholds match spec; missing data → `healthy` |
| `heartbeat-store.integration.test.ts` | integration | publish + latest + activeWith(N min) selectors |
| `watchdog.integration.test.ts` | integration | Stalled mission with no heartbeat in 6 min → `stuck_event(rule='stalled', auto_action='ping_then_restart')` written; cost-runaway → `paused` mission |
| `kill-switch.integration.test.ts` | integration | level=workflow blocks the mission, writes `kill_events` row; level=workspace blocks all missions of that workspace |

## §6.6 Gate criteria

- [x] Migrations `0104`–`0108` applied; journal updated; Drizzle schemas exported.
- [x] All tests in §6.5 pass — 28 in `src/platform/self-healing/` (9 watchdog-rules + 8 health-scorer unit; 3 heartbeat-store + 4 watchdog + 4 kill-switch integration). Full platform suite remains green.
- [x] Stalled-mission demo persisted in `watchdog.integration.test.ts`: 10-minute-old heartbeat → `runOnce` writes one `stuck_events(rule='stalled', auto_action='ping_then_restart')` with `elapsedMin > 5` in diagnosis JSON; ping does NOT cascade into a `kill_event`.
- [x] Cost-runaway path also covered: `state_payload.costRatio=3` + heartbeat with $12.50 → `stuck_events(rule='cost_runaway', auto_action='pause_and_snapshot')` AND a paired `kill_events(level='workflow', triggered_by='auto:cost_runaway')` row, mission flipped to `blocked`.
- [x] `_index.md` Phase Status updated.

## §6.7 Implementation notes (post-build)

- Watchdog rules read mission "hints" from `missions.state_payload.{costRatio,intakeVolumeRatio,waitingOnCycle,approvalQueueOverflow}`. The strategic-loop runner is responsible for stamping these hints during `tick()`. Phase 6 does not back-compute them from raw events; that's a Phase 7 wiring task.
- Rules 5 (mcp_cascade) and 6 (state_corruption) ship as detect-only stubs; the corruption rule fires on `progressMarker LIKE 'invariant_violation%'`. The full evidence-collection sweep is deferred to Phase 14b chaos tests.
- `KillSwitch.apply()` is the single audit choke point. Both manual user kills (`triggered_by='user:<id>'`) and watchdog auto-kills (`triggered_by='auto:<rule>'`) flow through the same code path; `affected_mission_ids` always reflects what was actually transitioned.
- Workspace-level kill also flips `companies.status='paused'` so Phase 7 can short-circuit new mission spawns until ops un-pauses.
- Health score worktable allows mission-level rows (`mission_id NOT NULL`); workspace-level rollup is computed at read-time rather than persisted, so we don't need a separate uniqueness rule for workspace-only rows.

## §6.8 Files touched

- `packages/db/src/migrations/0104_liveness_heartbeats.sql` … `0108_human_drag_in_events.sql` (+ journal)
- `packages/db/src/schema/liveness_heartbeats.ts`, `stuck_events.ts`, `kill_events.ts`, `workflow_health.ts`, `human_drag_in_events.ts` (+ index re-exports)
- `server/src/platform/self-healing/heartbeat-store.ts`
- `server/src/platform/self-healing/watchdog-rules.ts` (pure)
- `server/src/platform/self-healing/health-scorer.ts` (pure)
- `server/src/platform/self-healing/kill-switch.ts`
- `server/src/platform/self-healing/watchdog.ts`
- `server/src/platform/platform.ts` — exposes `platform.heartbeats`, `platform.killSwitch`, `platform.watchdog`
- 5 test files in `server/src/platform/self-healing/__tests__/`
