# Phase 5 — Human Intake Hub

**Status:** done (Apr 29) — Mile-A milestone scoped to feature_request E2E.
**Owner:** Khoa
**Depends on:** Phase 1 (embeddings for dedup), Phase 2 (workspace + WFQ), Phase 3 (approval patterns), Phase 4 (mission spawn target)
**Anchors:** [[../Human-Intake-and-Solution-Loop-Design]] · [[../Master-Architecture-Overview]]
**Master plan:** [[../Implementation-Master-Plan#Phase 5]]

## Goal

Single funnel for **all** human input — questions, bug reports, feature requests, strategic input, feedback — that classifies the input, deduplicates against open intakes, emits an L1 (class-bracket) timeline, and (when appropriate) spawns a mission. Mile-A milestone: anh submits a `feature_request` → triage → solution candidates → Choose → mission spawned → ETA visible.

## Non-goals (deferred to later phases)

- DBSCAN clustering of feedback (`feedback_clusters` populator) — Phase 10.
- L2 Monte Carlo timeline estimator — Phase 11 (needs KB + outcome history).
- L3 live-progress estimator — needs heartbeat data; Phase 6+.
- Email / Slack / mobile capture surfaces — Phase 7 (after webhook hardening) and Phase 15 (mobile UX).
- Auto-promotion of feedback clusters to intakes — Phase 10.

## §5.1 Schema additions

Numbering follows Phase 4 (last migration `0097`).

`0098_intake_items.sql`
```
intake_items
 - id uuid pk default gen_random_uuid()
 - company_id uuid not null fk companies (cascade)         -- workspace owner
 - type text not null                                      -- problem|feature_request|bug_report|feedback_general|feedback_release|feedback_feature|strategic_input|question
 - priority text                                           -- P0|P1|P2|P3
 - state text not null default 'triaged'                   -- triaged|diagnosed|spec_drafted|candidates_ready|approved_solution|in_progress|review_ready|deployed|accepted|closed
 - submitter_user_id text                                  -- nullable for system-emitted intakes
 - submitter_mood int                                      -- 1-5
 - raw_text text not null
 - attachments jsonb not null default '[]'
 - classified_type_conf numeric(5,4)
 - linked_release_tag text
 - linked_feature_key text
 - duplicate_of uuid fk intake_items (set null)
 - mission_id uuid fk missions (set null)                  -- set when intake spawns a mission
 - source text not null default 'human_console'            -- human_console|api|auto_promoted
 - source_ref text
 - created_at timestamptz default now()
 - updated_at timestamptz default now()
 - closed_at timestamptz
 - index (company_id, state) WHERE closed_at IS NULL
 - index (company_id, type, created_at)
 - index (mission_id) WHERE mission_id IS NOT NULL
```

`0099_intake_workflow_states.sql`
```
intake_workflow_states
 - id uuid pk
 - intake_id uuid not null fk intake_items (cascade)
 - state text not null
 - entered_at timestamptz default now()
 - left_at timestamptz
 - duration_min numeric(10,2)                              -- left_at - entered_at, populated when state ends
 - actor_agent_id uuid fk agents (set null)
 - actor_user_id text
 - notes text
 - index (intake_id, entered_at)
```

`0100_intake_solutions.sql`
```
intake_solutions
 - id uuid pk
 - intake_id uuid not null fk intake_items (cascade)
 - candidate_idx int not null
 - title text not null
 - scope jsonb not null default '{}'
 - effort_days numeric(8,2)
 - risk_score numeric(5,4)
 - eta_p50_days numeric(8,2)
 - eta_p90_days numeric(8,2)
 - cost_usd numeric(10,4)
 - selected boolean not null default false
 - selection_reason text
 - approval_id uuid fk approvals (set null)
 - created_at timestamptz default now()
 - unique (intake_id, candidate_idx)
 - index (intake_id, selected)
```

`0101_intake_timeline_estimates.sql`
```
intake_timeline_estimates
 - id uuid pk
 - intake_id uuid not null fk intake_items (cascade)
 - level text not null                                     -- L1|L2|L3
 - p50_days numeric(8,2)
 - p90_days numeric(8,2)
 - source text not null                                    -- bracket|monte_carlo|live_heartbeat
 - rationale text
 - computed_at timestamptz default now()
 - index (intake_id, level, computed_at)
```

`0102_intake_outcome_tracker.sql`
```
intake_outcome_tracker
 - intake_id uuid pk fk intake_items (cascade)
 - predicted_eta_p50_days numeric(8,2)
 - actual_days numeric(8,2)
 - predicted_cost_usd numeric(10,4)
 - actual_cost_usd numeric(10,4)
 - acceptance_status text                                  -- accepted|rejected|silent
 - submitter_satisfaction int                              -- 1-5 follow-up
 - measured_at timestamptz
```

`0103_feedback_clusters.sql` — schema only; populator deferred to Phase 10 per [[../Implementation-Master-Plan#Phase 10]].
```
feedback_clusters
 - id uuid pk
 - company_id uuid not null fk companies (cascade)
 - cluster_size int not null default 0
 - theme text
 - centroid_intake_id uuid fk intake_items (set null)      -- representative member; vector lives on intake_items via Phase 1 entity_embeddings
 - member_intake_ids uuid[] not null default '{}'
 - promoted_to_intake_id uuid fk intake_items (set null)
 - status text not null default 'open'                     -- open|promoted|dismissed
 - created_at timestamptz default now()
 - updated_at timestamptz default now()
 - index (company_id, status)
```

## §5.2 Services

`server/src/intake/`
```
intake-store.ts          CRUD (create / loadById / list by workspace, state filter)
intake-classifier.ts     LLM classifier with deterministic heuristic fallback (8 types) + confidence
intake-deduper.ts        Cosine over entity_embeddings (Phase 1) → propose merge ≥ 0.85, hint 0.70-0.85
intake-priority.ts       Priority bucketing per Human-Intake §4.3 (pure)
intake-timeline-l1.ts    Class-based bracket per Human-Intake §6 (pure)
intake-triage-agent.ts   Orchestrates classify → dedup → priority → L1 → workflow_state insert
intake-workflow.ts       Per-type state advance: feature_request → spec_drafted → candidates_ready → approved_solution → mission_id
intake-mission-bridge.ts Spawns a Phase-4 mission from a selected solution candidate; writes intake_items.mission_id
__tests__/
  intake-classifier.test.ts          unit (heuristic fallback)
  intake-priority.test.ts            unit
  intake-timeline-l1.test.ts         unit
  intake-store.integration.test.ts   round-trip + state transitions
  intake-triage-agent.integration.test.ts  classify→dedup→priority→L1
  intake-workflow.integration.test.ts      feature_request happy path → mission spawn
```

### Classifier
- Pure heuristic for tests + offline mode (keyword scoring against 8 type definitions).
- LLM hook is opt-in (deferred to Phase 7's LLM provider wiring); the service accepts a classifier callback and falls back to heuristic.
- Confidence ≥ 0.7 → auto-route. < 0.7 → emit a `proposal_pattern: choose` approval (top-2 candidates) via Phase 3 `ApprovalRouter`.

### Deduper
- Reads embeddings emitted by Phase 1 `entity_embeddings`. For Phase 5 we **embed-on-write** (intake create → embedding job) and run cosine against open intakes in same workspace.
- Phase 5 ships a synchronous in-process embedding stub that uses the registered embedding provider; if no provider is configured, dedup is skipped and we log "dedup_skipped" so tests still run.

### Workflow runner (Mile-A path: feature_request)
Implements §5.2 happy path:
```
triaged → spec_drafted → candidates_ready → approved_solution → in_progress (mission spawned)
```
- `spec_drafted` is reached automatically once the workflow runner produces a one-paragraph spec (LLM stub for Phase 5 — accepts a callback, falls back to a deterministic stub for tests).
- `candidates_ready` always emits 2 candidates with effort/risk/eta computed via `intake-timeline-l1`.
- Selection happens through Phase 3's `ApprovalRouter` (`proposal_pattern: choose`). When the chosen candidate is recorded, the workflow runner advances to `approved_solution` and calls `intake-mission-bridge.spawn(intakeId)`.
- Mission spawn creates a `missions` row with `goal = intake.spec`, `title = intake.title`, `state = 'intake'`. The intake's `mission_id` is back-filled.

Other workflows (problem, bug_report, feedback_*, question, strategic_input) ship as **stubs** that move triaged → closed/parked with a TODO comment pointing to their owning phase. Mile-A only requires feature_request E2E.

## §5.3 APIs

Read/write endpoints behind existing auth.

```
POST   /api/companies/:cid/intakes              { type?, title, raw_text, attachments?, mood?, release_tag?, feature_key? } → intake row + L1 estimate
GET    /api/companies/:cid/intakes              query: state, type, limit
GET    /api/intakes/:id                         intake + workflow states + solutions + timeline estimates
POST   /api/intakes/:id/advance                 manual workflow tick (debug + tests)
POST   /api/intakes/:id/select-candidate        body: { candidate_idx, reason? } → triggers approval + mission spawn
POST   /api/intakes/:id/close                   body: { acceptance_status: accepted|rejected|silent }
GET    /api/intakes/:id/timeline                latest L1/L2/L3 (L2/L3 = empty in this phase)
```

UI work is **deferred to Phase 15** for full polish; Phase 5 ships a minimal "raw" web page (table + detail) so anh can run Mile-A by hand.

## §5.4 Telemetry / observability

- Every state transition writes `intake_workflow_states` (entered_at + duration_min on exit).
- Embed `mission.spawned` insight into the workspace brain via Phase 4 `BrainStore` when an intake spawns a mission.
- `intake_outcome_tracker` rows are pre-allocated at `approved_solution` so the daily T+7 cron (Phase 6) has a target.

## §5.5 Tests

| Test | Layer | What it proves |
| --- | --- | --- |
| `intake-classifier.test.ts` | unit | Heuristic returns sensible top-1 for canonical phrases per Human-Intake §2.2 |
| `intake-priority.test.ts` | unit | Bucketing into P0/P1/P2/P3 matches §4.3 rules |
| `intake-timeline-l1.test.ts` | unit | Class brackets emit (p50, p90) per type |
| `intake-store.integration.test.ts` | integration | Create/list/state-advance round-trips, FK cascades from `companies` |
| `intake-triage-agent.integration.test.ts` | integration | classify (heuristic) → dedup-skipped → priority → L1 → state=`triaged` |
| `intake-workflow.integration.test.ts` | integration | feature_request: triaged → spec_drafted → candidates_ready (2 candidates persisted) → select-candidate → approved_solution → mission row created with intake.mission_id back-filled |

## §5.6 Gate criteria (Mile-A milestone)

- [x] Migrations `0098`–`0103` applied; journal updated; Drizzle schemas exported.
- [x] All tests in §5.5 pass — 36 in `src/intake/` (9 classifier + 8 priority + 5 timeline-L1 unit; 7 store + 4 triage-agent + 3 workflow integration). Full platform+intake suite is 98/98 green.
- [x] Workflow E2E covered by `intake-workflow.integration.test.ts`: triage classifies feature_request → workflow advances triaged → spec_drafted → candidates_ready (2 persisted with ETA from L1 brackets) → selectCandidate returns missionId, mission row created with goal containing the spec, intake state = `in_progress`, outcome tracker pre-allocated.
- [x] `_index.md` Phase Status updated.

## §5.7 Implementation notes (post-build)

- HTTP/UI surfaces from §5.3 are intentionally deferred to Phase 7 (route wiring) and Phase 15 (UX polish). The service layer is fully wired so Phase 7 can attach `express.Router` instances over `IntakeStore` + `IntakeTriageAgent` + `IntakeWorkflowRunner` without further refactor.
- Dedup against open intakes is **scaffolded** (intake row carries `duplicate_of`) but the embedding-write side is not invoked from `IntakeTriageAgent` because Phase 1's embedding provider is not registered as a global yet — wiring lands in Phase 7. Tests therefore exercise the no-dedup path.
- `IntakeWorkflowRunner.selectCandidate` integrates directly with the Phase-3 approval surface only at the persistence layer (selection flips `selected=true` and stores the user reason). Hooking a `proposal_pattern: choose` approval row into the same flow is a one-liner once Phase 7's HTTP routes exist.
- Mission spawn writes a `missions` row with `status='intake'` so the Phase-4 `MissionRunner.tick()` can pick it up immediately. The intake's `mission_id` is back-filled atomically.
- Outcome tracker is pre-allocated at `approved_solution` with predicted ETA + cost so Phase 6's daily T+7 cron has a target row to update.

## §5.8 Files touched

- `packages/db/src/migrations/0098_intake_items.sql` … `0103_feedback_clusters.sql` (+ journal)
- `packages/db/src/schema/intake_items.ts`, `intake_workflow_states.ts`, `intake_solutions.ts`, `intake_timeline_estimates.ts`, `intake_outcome_tracker.ts`, `feedback_clusters.ts` (+ index re-exports)
- `server/src/intake/intake-classifier.ts` (heuristic + LLM-hookable)
- `server/src/intake/intake-priority.ts` (pure)
- `server/src/intake/intake-timeline-l1.ts` (pure)
- `server/src/intake/intake-store.ts` (CRUD + state log + timeline + solutions + outcome tracker)
- `server/src/intake/intake-triage-agent.ts` (classify → priority → L1 → persist)
- `server/src/intake/intake-mission-bridge.ts` (Phase-4 mission spawn)
- `server/src/intake/intake-workflow.ts` (feature_request happy path; other types parked)
- 6 test files in `server/src/intake/__tests__/`
