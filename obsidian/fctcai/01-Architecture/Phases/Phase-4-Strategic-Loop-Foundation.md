# Phase 4 — Strategic Loop Foundation

**Status:** done (Apr 29)
**Owner:** Khoa
**Depends on:** Phase 2 (workspace primitives, capability registry), Phase 3 (autonomy gate)
**Anchors:** [[../ADR-0003-State-Machine-vs-LangGraph]] · [[../ADR-0007-Brain-Storage]] · [[../Master-Architecture-Overview]]

## Goal

Give every workspace a deterministic, restartable **Strategic Loop**:

```
   ┌──────────┐      ┌───────────┐      ┌────────────┐      ┌──────────┐
   │  intake  │ ──▶  │  planning │ ──▶  │ executing  │ ──▶  │ reflecting│
   └──────────┘      └───────────┘      └────────────┘      └──────────┘
                          ▲                  │                   │
                          └──── replan ◀─────┘                   ▼
                                                         done | blocked
```

A **mission** is the unit a Strategic Loop runs over. It is owned by a workspace, has a goal, accumulates steps and reflections, and finishes (success | failure | abandoned). The loop is a TS state machine (per ADR-0003), persisted, and resumable after a crash.

## Non-goals (deferred)

- Cross-mission memory diffusion — Phase 11 / 12.
- DBSCAN clustering of reflections — Phase 10.
- Brain summarization / compression — Phase 11.
- Multi-agent hand-off coordination — Phase 5/8.

## §4.1 Schema additions

`0094_missions.sql`
```
missions
 - id uuid pk default gen_random_uuid()
 - company_id uuid not null fk companies (cascade)
 - title text not null
 - goal text not null                      -- the desired outcome
 - status text not null default 'intake'   -- intake|planning|executing|reflecting|done|blocked
 - state_payload jsonb not null default '{}'  -- machine-private blackboard
 - blocked_reason text
 - finished_at timestamptz
 - finished_outcome text                   -- success|failure|abandoned
 - created_at timestamptz default now()
 - updated_at timestamptz default now()
 - index (company_id, status)
```

`0095_mission_steps.sql`
```
mission_steps
 - id uuid pk
 - mission_id uuid not null fk missions (cascade)
 - seq integer not null                    -- order within the mission
 - kind text not null                      -- plan|execute|reflect|gate
 - title text not null
 - inputs jsonb not null default '{}'
 - outputs jsonb not null default '{}'
 - status text not null default 'pending'  -- pending|running|done|failed|skipped
 - approval_id uuid fk approvals (set null) -- if step required a gate
 - started_at timestamptz
 - finished_at timestamptz
 - error text
 - unique (mission_id, seq)
 - index (mission_id, status)
```

`0096_mission_reflections.sql`
```
mission_reflections
 - id uuid pk
 - mission_id uuid not null fk missions (cascade)
 - kind text not null                      -- learning|risk|next_action
 - body text not null
 - tags text[] default '{}'
 - created_at timestamptz default now()
 - index (mission_id, created_at)
```

`0097_mission_state_transitions.sql` — append-only log so we can replay.
```
mission_state_transitions
 - id uuid pk
 - mission_id uuid not null fk missions (cascade)
 - from_status text not null
 - to_status text not null
 - reason text
 - actor_agent_id uuid fk agents (set null)
 - actor_user_id text
 - occurred_at timestamptz default now()
 - index (mission_id, occurred_at)
```

## §4.2 Services

`server/src/platform/strategic-loop/`
```
mission-state-machine.ts   Pure state graph: legal transitions + guards
brain-store.ts             Reads/writes documents.key='brain' per ADR-0007
mission-runner.ts          Drives one mission tick; handles persistence
__tests__/
  mission-state-machine.test.ts
  brain-store.integration.test.ts
  mission-runner.integration.test.ts
```

### State machine

Legal transitions:

| from | to | who | guard |
| --- | --- | --- | --- |
| intake | planning | runner | always |
| planning | executing | runner | at least 1 step queued |
| executing | reflecting | runner | all steps done OR step failed (blocked) |
| reflecting | planning | runner | new steps proposed |
| reflecting | done | runner | reflector says done |
| executing | blocked | runner | step failed AND no auto-retry |
| blocked | planning | user | user resumes |
| any non-terminal | blocked | runner | gate timeout |
| done | (terminal) | — | — |

The state machine is implemented as a switch table that returns either a `Transition` object or an `IllegalTransition` error. No effects.

### MissionRunner

`tick(missionId)` does one pass:
1. Load mission row + open steps + recent reflections.
2. Decide next move from current status (planning → call planner; executing → run next pending step; reflecting → call reflector).
3. Persist transition + step changes in a single transaction.
4. Return a `TickReport` with what happened.

The runner does **not** loop forever in-process. A scheduler (`server/src/realtime` or a cron) calls `tick()` per active mission. This keeps the loop crash-safe and naturally interleaves with WFQ.

### BrainStore (per ADR-0007)

Reads `documents` row where `(company_id, key='brain')`. If absent, creates one. Provides:
- `getBrain(workspaceId)` → `{ markdown, revisionId }`
- `appendInsight(workspaceId, kind, body)` → upserts a section under `## Insights` and creates a new `document_revisions` row.
- `getMissionBrain(workspaceId, missionId)` → namespaced subdoc (`brain/missions/<id>`).

## §4.3 APIs (read-side this phase)

- `POST /api/companies/:id/missions` — create mission with `{ title, goal }`.
- `GET /api/companies/:id/missions?status=` — list missions.
- `GET /api/missions/:id` — return mission + steps + reflections.
- `POST /api/missions/:id/tick` — manual tick (mostly for tests / debug).
- `GET /api/companies/:id/brain` — render the workspace brain.

The auto-tick loop is deferred to a follow-up; for Phase 4 we only need on-demand tick + manual seeding so the strategic loop can be exercised end-to-end.

## §4.4 Gate criteria

- [x] Migrations `0094`–`0097` applied; journal updated; Drizzle schemas exported.
- [x] State machine tests cover every legal + illegal transition (13 unit tests, including illegal directed pairs and user-vs-runner authority).
- [x] BrainStore round-trips (create-if-missing, append-insight, mission-namespaced subdocs) — 4 integration tests.
- [x] MissionRunner integration test: create mission → tick(intake→planning) → tick(planning→executing with seeded steps) → tick(executing→reflecting) → tick(reflecting→done). Plus replan loop and executing→blocked-on-failure paths — 3 integration tests.
- [x] `_index.md` Phase Status updated.

## §4.5 Implementation notes (post-build)

- `executing→reflecting` guard tightened to require **queued + pending + running == 0** so a mission can't reflect with un-started work; the original spec only checked pending+running.
- `MissionRunner` invokes the planner **before** the canTransition check for `planning→executing`, then re-projects step counts. This keeps the state-machine pure (no side-effect knowledge) while letting the runner seed legal preconditions.
- `executing` candidate order is preference-based: `failedSteps > 0` ⇒ try `blocked` first, else try `reflecting`. Same allow table, just first-match-wins on intent.
- `BrainStore.appendInsight` writes a new `document_revisions` row and bumps `documents.latest_revision_id` so the brain has a full audit trail. Mission-scoped notes use key `brain/missions/<id>` per ADR-0007.
- The runner emits `mission.done` insight to the workspace brain on terminal transition so the per-workspace brain accumulates lessons across missions.

## §4.6 Files touched

- `packages/db/src/schema/missions.ts`, `mission_steps.ts`, `mission_reflections.ts`, `mission_state_transitions.ts`
- `packages/db/migrations/0094_*.sql` … `0097_*.sql`
- `server/src/platform/strategic-loop/mission-state-machine.ts`
- `server/src/platform/strategic-loop/brain-store.ts`
- `server/src/platform/strategic-loop/mission-runner.ts`
- `server/src/platform/platform.ts` — exposes `platform.brain` and re-exports the strategic-loop surface.
- Tests: `server/src/platform/strategic-loop/__tests__/{mission-state-machine,brain-store.integration,mission-runner.integration}.test.ts`
