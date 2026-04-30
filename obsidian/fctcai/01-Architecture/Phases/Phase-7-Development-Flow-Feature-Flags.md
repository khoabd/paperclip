# Phase 7 — Development Flow + Feature Flags

**Status:** done (Apr 29)
**Owner:** Khoa
**Depends on:** Phase 4 (BrainStore insight append), Phase 6 (workspace primitives on companies)
**Anchors:** [[../Development-Flow-and-Release-Strategy]] · [[../Implementation-Master-Plan#Phase 7]]
**Master plan:** [[../Implementation-Master-Plan#Phase 7]]

## Goal

How code moves from design → production safely. Design docs have a versioned lifecycle state machine; conflict detection runs regex-based analysis across 4 conflict kinds; feature flags control rollout with workspace overrides; canary runs stage 0→5→25→50→100% with JSONB history append.

## Non-goals (deferred)

- HTTP routes (POST /api/design-docs, etc.) — Phase 15.
- UI board for design docs and feature flag admin — Phase 15.
- LLM-based tech-conflict detection (ADR violations) — Phase 8+.
- Metric-gated canary auto-advance (error rate thresholds) — Phase 14b.
- Branch governance / pre-PR gate pipeline — Phase 14a.

## §7.1 Schema additions

Numbering follows Phase 6 (last migration `0108`).

`0109_design_docs.sql`
```
design_docs
 - id uuid pk default gen_random_uuid()
 - company_id uuid not null fk companies (cascade)
 - project_id uuid fk projects (set null)
 - key text not null
 - title text not null
 - body text not null default ''
 - status text not null default 'proposed'       -- proposed|review|approved|in_dev|live|archived
 - conflicts_with uuid[] not null default '{}'
 - created_at timestamptz default now()
 - updated_at timestamptz default now()
 - unique (company_id, key)
 - index (company_id, status)
 - index (project_id, status)
```

`0110_design_doc_revisions.sql`
```
design_doc_revisions
 - id uuid pk
 - design_doc_id uuid not null fk design_docs (cascade)
 - revision_number integer not null
 - body text not null
 - change_summary text
 - created_by_user_id text
 - created_at timestamptz default now()
 - unique (design_doc_id, revision_number)
```

`0111_component_locks.sql`
```
component_locks
 - id uuid pk
 - company_id uuid not null fk companies (cascade)
 - project_id uuid fk projects (set null)
 - component_path text not null
 - locked_by_design_doc_id uuid fk design_docs (set null)
 - expires_at timestamptz
 - created_at timestamptz default now()
 - unique (company_id, project_id, component_path)
```

`0112_conflict_events.sql`
```
conflict_events
 - id uuid pk
 - company_id uuid not null fk companies (cascade)
 - kind text not null                             -- schema|api|ui|behavior
 - design_doc_a_id uuid fk design_docs (set null)
 - design_doc_b_id uuid fk design_docs (set null)
 - detail jsonb not null default '{}'
 - detected_at timestamptz default now()
 - resolved_at timestamptz
 - resolution_notes text
 - index (company_id, kind, detected_at)
 - partial index (company_id, detected_at) WHERE resolved_at IS NULL
```

`0113_feature_flags.sql`
```
feature_flags
 - id uuid pk
 - company_id uuid not null fk companies (cascade)
 - key text not null
 - description text
 - status text not null default 'off'             -- off|canary|on
 - rollout_percent integer not null default 0
 - owner_user_id text
 - created_at timestamptz default now()
 - updated_at timestamptz default now()
 - unique (company_id, key)
```

`0114_feature_flag_workspace_overrides.sql`
```
feature_flag_workspace_overrides
 - id uuid pk
 - flag_id uuid not null fk feature_flags (cascade)
 - company_id uuid not null fk companies (cascade)
 - value boolean not null
 - created_at timestamptz default now()
 - unique (flag_id, company_id)
```

`0115_canary_runs.sql`
```
canary_runs
 - id uuid pk
 - feature_flag_id uuid not null fk feature_flags (cascade)
 - started_at timestamptz default now()
 - ended_at timestamptz
 - current_percent integer not null default 0
 - history jsonb not null default '[]'            -- [{percent, at}] append-only
 - status text not null default 'running'         -- running|completed|aborted
 - index (feature_flag_id, started_at)
```

## §7.2 Services

`server/src/dev-flow/`
```
lifecycle/
  design-doc-state-machine.ts   pure canTransition(input) → {ok, reason}
  design-doc-service.ts         create / revise / transition; emits brain insight on 'live'
conflict/
  conflict-detector.ts          pure detectConflicts(bodyA, bodyB) + DB runOnDesignDoc(id)
feature-flags/
  feature-flag-evaluator.ts     evaluate({companyId, flagKey, userId?}) + pure evaluatePure()
  canary-controller.ts          start(flagId) / step(canaryId, target) / abort(canaryId)
index.ts                        barrel re-export (no HTTP routes)
__tests__/
  design-doc-lifecycle.test.ts
  conflict-detector.test.ts
  feature-flag-evaluator.test.ts
  canary-controller.integration.test.ts
  design-doc-service.integration.test.ts
```

### DesignDocStateMachine transitions

| From | To | Actor | Guard |
| --- | --- | --- | --- |
| `proposed` | `review` | runner | — |
| `review` | `approved` | runner | no open conflicts |
| `review` | `proposed` | runner | on revision |
| `approved` | `in_dev` | runner | — |
| `in_dev` | `live` | runner | feature flag at `on` or 100% |
| `live` | `archived` | runner | — |
| `*` | `archived` | user | force (any non-archived state) |

### ConflictDetector kinds

| Kind | Detection |
| --- | --- |
| `schema` | `CREATE TABLE <name>` or `ALTER TABLE <name> ADD COLUMN` overlap |
| `api` | `(METHOD /path)` route signature overlap |
| `ui` | `component: <token>` overlap |
| `behavior` | `feature_key: <token>` overlap |

### FeatureFlagEvaluator precedence

1. `status='off'` → disabled (beats everything except short-circuit).
2. Workspace override row → forced value.
3. `status='on'` → enabled.
4. `status='canary'` → FNV-1a hash bucket (userId ?? companyId salted by flagKey) vs `rollout_percent`.

### CanaryController stages

`0 → 5 → 25 → 50 → 100`. `start()` opens at 5%; `step()` advances to 25/50/100; `abort()` resets to 0. Each call appends a `{percent, at}` entry to `history` JSONB and syncs `feature_flags.rollout_percent`. At 100%, flag flips to `status='on'`; on abort, flag flips to `status='off'`.

## §7.3 APIs

HTTP routes deferred to Phase 15. Phase 7 ships service layer only. Barrel re-export at `server/src/dev-flow/index.ts`.

## §7.4 Tests

| Test | Layer | What it proves |
| --- | --- | --- |
| `design-doc-lifecycle.test.ts` | unit | 28 cases: every legal + illegal directed pair, user force-archive, `legalRunnerTargets` |
| `conflict-detector.test.ts` | unit + integration | 8 pure cases (4 kinds + no-false-positives + ALTER TABLE); 4 integration: ui/schema conflict written, unrelated → 0 rows, archived skipped |
| `feature-flag-evaluator.test.ts` | unit + integration | 7 pure (status off/on, override beats rollout, determinism, rollout 0%/100%); 5 integration (unknown/off/on/override-true/override-false/canary-100) |
| `canary-controller.integration.test.ts` | integration | Full ramp 5→25→50→100: history length 4, rollout_percent=100, status=on; abort resets; step-after-complete throws |
| `design-doc-service.integration.test.ts` | integration | create+revision-1; revise writes new row + bumps number; multi-revise monotonic; transition happy path; conflict-blocked; brain insight on live; not-found guard; user force-archive |

## §7.5 Gate criteria

- [x] Migrations `0109`–`0115` applied; journal updated; Drizzle schemas exported from `packages/db/src/schema/index.ts`.
- [x] All Phase 7 tests pass — 67 tests in `src/dev-flow/` (28 unit lifecycle + 12 conflict + 14 flag-evaluator + 4 canary + 9 design-doc-service). Full platform + intake + dev-flow suite: 193/193 green.
- [x] Two design docs touching the same `component:` token → `ConflictDetector.runOnDesignDoc()` writes one `conflict_events` row with `kind='ui'`; two docs with same `CREATE TABLE` → `kind='schema'`.
- [x] Feature flag staged rollout demonstrated by `canary-controller.integration.test.ts`: `history.length===4` (entries at 5, 25, 50, 100) and `feature_flags.rollout_percent===100` after full ramp.
- [x] `_index.md` Phase Status block updated: Phase 7 closed, Phase 8 marked next.
- [x] `Phases/Phase-7-Development-Flow-Feature-Flags.md` created (this file).

## §7.6 Implementation notes (post-build)

- `evaluatePure()` is exported alongside the DB-backed `FeatureFlagEvaluator` so callers that have already loaded a flag row avoid a second DB round-trip. Both use identical precedence logic.
- `DesignDocStateMachine.canTransitionDesignDoc()` is structurally identical to Phase 4's `canTransition()` — pure function, `TransitionVerdict` shape, `legalRunnerTargets()` helper. Tests follow the same `legal/illegal pair` pattern.
- `ConflictDetector.runOnDesignDoc()` skips `archived` docs only; a doc in `proposed` or `review` is still a valid conflict target. This is intentional — conflict detection runs as early as `proposed` so humans see overlap before approval.
- `DesignDocService.transition()` is the single choke point for status changes; it delegates purely to the state machine and only writes to DB after `ok=true`. The brain insight fires inside the same call so it is guaranteed to land if the transition persists.
- `CanaryController.step()` accepts only `25 | 50 | 100` (TypeScript-enforced). Callers cannot accidentally skip to an arbitrary percent. Abort is the only way to go back to 0.
- `component_locks` schema is included (migration `0111`) but no `ComponentLockService` is wired yet — the schema supports Phase 14a branch governance without blocking Phase 7 test gate. The table will remain empty until Phase 14a.

## §7.7 Files touched

- `packages/db/src/migrations/0109_design_docs.sql` … `0115_canary_runs.sql` (+ journal)
- `packages/db/src/schema/design_docs.ts`, `design_doc_revisions.ts`, `component_locks.ts`, `conflict_events.ts`, `feature_flags.ts`, `feature_flag_workspace_overrides.ts`, `canary_runs.ts` (+ index re-exports)
- `server/src/dev-flow/lifecycle/design-doc-state-machine.ts`
- `server/src/dev-flow/lifecycle/design-doc-service.ts`
- `server/src/dev-flow/conflict/conflict-detector.ts`
- `server/src/dev-flow/feature-flags/feature-flag-evaluator.ts`
- `server/src/dev-flow/feature-flags/canary-controller.ts`
- `server/src/dev-flow/index.ts`
- 5 test files in `server/src/dev-flow/__tests__/`
- `obsidian/fctcai/01-Architecture/_index.md` — Phase Status updated
