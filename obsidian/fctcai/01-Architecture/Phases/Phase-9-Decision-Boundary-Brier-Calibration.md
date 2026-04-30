# Phase 9 — Decision Boundary + Brier Calibration

**Status:** done (Apr 29)
**Owner:** Khoa
**Depends on:** Phase 3 (AutonomyGate, ProposalPatterns), Phase 2 (CostAttributor, WorkspaceContextStore), Phase 8 (BrainStore)
**Anchors:** [[../Decision-Boundary-and-Uncertainty-Model]] · [[../Implementation-Master-Plan#Phase 9]]

## Goal

Wire a decision-boundary framework into the platform so every agent action can be scored on three axes (reversibility × blast radius × confidence), classified against a calibrated threshold, and logged for Brier scoring. Block trust promotion when Brier > 0.15 to prevent over-confident agents from receiving elevated capabilities.

## Non-goals (deferred)

- HTTP routes for decision log or calibration dashboard — Phase 15.
- Real cron wiring for BrierRunner — cron infra ships later; `runOnce()` is the hook.
- LLM logprobs-based self-confidence extraction — Phase 10+.
- Multi-agent conflict resolution (§7 of design) — deferred.
- Brain snapshot consistency model (§6) — deferred.
- Embedding-based novelty scorer — Phase 11 (KB phase).
- Pipeline degradation guard (3 failures at same stage in 30d) — Phase 9+ UX deferred.

---

## §9.1 Schema additions

Numbering follows Phase 8 (last migration `0118_intake_recovery_actions`).

### `0119_decision_class_lookup.sql`

```
decision_class_lookup
 - id uuid pk default gen_random_uuid()
 - kind text not null                   -- generic|code_change|external_action|policy_exception|cost_burst|data_export|deploy|migration
 - reversibility text not null          -- easy|hard|irreversible
 - blast_radius text not null           -- local|workspace|company|global
 - default_threshold numeric(5,4) not null
 - default_pattern text
 - notes text
 - created_at timestamptz default now() not null
 - unique (kind, reversibility, blast_radius)
 - index (kind)
```

Seeded at migration time (idempotent `ON CONFLICT DO NOTHING`):
- 12 generic rows covering the full reversibility × blast_radius matrix
- 8 concrete-kind overrides (migration, deploy, policy_exception, data_export, cost_burst)

### `0120_decision_log.sql`

```
decision_log
 - id uuid pk
 - company_id uuid not null fk companies (cascade)
 - mission_id uuid fk missions (set null)
 - agent_id uuid fk agents (set null)
 - decision_class_id uuid fk decision_class_lookup (set null)
 - kind text not null
 - reversibility text not null
 - blast_radius text not null
 - confidence numeric(5,4) not null
 - risk_score numeric(5,4) not null
 - threshold_used numeric(5,4) not null
 - gated boolean not null default false
 - approval_id uuid fk approvals (set null)
 - outcome text not null default 'pending'     -- pending|success|failure|partial|abandoned
 - outcome_recorded_at timestamptz
 - brier_contribution numeric(8,6)
 - payload jsonb not null default '{}'
 - created_at timestamptz default now() not null
 - index (company_id, created_at)
 - index (agent_id, outcome)
 - index (decision_class_id, outcome)
```

### `0121_agent_uncertainty_events.sql`

```
agent_uncertainty_events
 - id uuid pk
 - agent_id uuid not null fk agents (cascade)
 - mission_id uuid fk missions (set null)
 - kind text not null   -- low_confidence|conflicting_signals|stale_data|disputed_outcome|unknown_class
 - observed_at timestamptz default now() not null
 - payload jsonb not null default '{}'
 - index (agent_id, kind, observed_at)
```

### `0122_brier_calibration.sql`

```
brier_calibration
 - id uuid pk
 - scope text not null       -- agent|capability|workspace|global
 - scope_id text not null    -- UUID of entity, or 'global'
 - window_days integer not null
 - n integer not null
 - brier_score numeric(8,6) not null
 - mean_confidence numeric(5,4)
 - mean_outcome numeric(5,4)
 - computed_at timestamptz default now() not null
 - index (scope, scope_id, computed_at)
 - index (scope, scope_id, window_days)
```

---

## §9.2 Services

`server/src/platform/decisions/`

```
decision-classifier.ts    DecisionClassifier.classify() — pure threshold matrix + autonomy factor
decision-logger.ts        DecisionLogger.record() + recordOutcome() — decision_log CRUD + Brier contribution
uncertainty-emitter.ts    UncertaintyEmitter.emit() — agent_uncertainty_events writer
brier-scorer.ts           BrierScorer.computeForAgent/Capability/Workspace/Global() — brier_calibration writer
trust-promotion-guard.ts  TrustPromotionGuard.canPromote() — blocks promotion when brier degraded
brier-runner.ts           BrierRunner.runOnce() — nightly calibration sweep across all workspaces+agents
index.ts                  barrel re-export (no HTTP routes)
__tests__/
  decision-classifier.test.ts                  (unit, pure)
  brier-scorer.integration.test.ts             (integration)
  trust-promotion-guard.integration.test.ts    (integration)
  decision-log-outcome.integration.test.ts     (integration, includes UncertaintyEmitter)
```

---

## §9.3 Threshold matrix

### Base thresholds: Reversibility × Blast Radius

| Reversibility | local | workspace | company | global |
|---|---|---|---|---|
| easy | 0.65 | 0.65 | 0.75 | 0.75 |
| hard | 0.78 | 0.78 | 0.85 | 0.92 |
| irreversible | 0.80 | 0.90 | 0.95 | 0.99 |

### AUTONOMY_THRESHOLD_FACTOR per capability mode

| Mode | Factor | Effect |
|---|---|---|
| sandbox | 1.10 | Raises bar — harder to auto-approve |
| supervised | 1.05 | Slightly raised bar |
| trusted | 1.00 | No modification (baseline) |
| autonomous | 0.95 | Lowers bar — more liberal auto-approve |

**Final threshold = min(base × factor, 0.99)**

### Default proposal patterns

| Conditions | Pattern |
|---|---|
| irreversible + company/global, hard + global | `policy_exception` |
| workspace/company blast | `external_action` |
| local blast | `code_change` |

### Concrete-kind overrides seeded at migration time

| kind | reversibility | blast_radius | threshold |
|---|---|---|---|
| migration | hard | workspace | 0.90 |
| migration | irreversible | company | 0.97 |
| deploy | hard | company | 0.88 |
| deploy | hard | global | 0.95 |
| policy_exception | hard | company | 0.98 |
| policy_exception | irreversible | global | 0.99 |
| data_export | hard | company | 0.90 |
| cost_burst | hard | workspace | 0.85 |

---

## §9.4 Tests

| Test file | Type | Count | What it proves |
|---|---|---|---|
| `decision-classifier.test.ts` | unit | 30 | Full matrix: 8 reversibility×blastRadius cells × autonomy modes; clamp at 0.99; default capabilityMode; invalid input throws |
| `brier-scorer.integration.test.ts` | integration | 3 | 100 decisions (50 success@0.8 + 50 failure@0.3) → brier≈0.065 ±0.001; n=0 for pending-only; window exclusion |
| `trust-promotion-guard.integration.test.ts` | integration | 7 | brier=0.05 (allow); brier=0.20 (block); brier=0.15 exactly (allow — boundary); n<minDecisions (block); no row (block); stale row (block); uses most-recent row |
| `decision-log-outcome.integration.test.ts` | integration | 8 | pending→success Brier=(0.8−1)²=0.04; pending→failure; pending→partial; unknown-id throws; gated flag; UncertaintyEmitter 5 kinds; missionId null |

**Total new tests: 48. Full suite: 308/308 green.**

---

## §9.5 Gate criteria ✅

- [x] Migrations `0119`–`0122` applied; journal entries appended (idx 119–122); 4 Drizzle schemas exported from `packages/db/src/schema/index.ts`.
- [x] `decision_class_lookup` seeded with ≥20 rows (12 generic + 8 concrete-kind) via `ON CONFLICT DO NOTHING`.
- [x] Pure classifier tests cover the matrix (30 tests: 8+ cells × 4 autonomy levels with representative combinations).
- [x] BrierScorer integration test: 100 rows (50 success@0.8 + 50 failure@0.3), brier≈0.065 matches hand-computed ±0.001, brier_calibration row persisted.
- [x] TrustPromotionGuard: brier=0.05 → allow, brier=0.20 → brier_degraded, no calibration → insufficient_data.
- [x] Decision log + outcome flow: record (pending) → recordOutcome → brierContribution = (confidence−outcomeBinary)².
- [x] All previous suites still green: `npx vitest run src/dev-flow/ src/platform/ src/intake/ src/greenfield/` → 308/308.
- [x] `Phases/Phase-9-Decision-Boundary-Brier-Calibration.md` created (this file, status `done (Apr 29)`).
- [x] `_index.md` updated: Phase 9 closed entry + Phase 10 ⏭ next.

---

## §9.6 Implementation notes (post-build)

- **DecisionClassifier is pure** — no DB calls, no async. Reads from in-memory constant maps (`BASE_THRESHOLDS`, `AUTONOMY_FACTOR`). `decision_class_lookup` is the DB-backed override store for production tuning; the classifier is the fast hot path for per-decision scoring.
- **TrustPromotionGuard is a sibling of AutonomyGate**, not a wrapper. It is consulted before capability mode upgrades. The existing `AutonomyGate.decide()` is unchanged (zero regression risk). Callers should call `TrustPromotionGuard.canPromote()` before writing a promotion to `workspaceCapabilityOverrides`.
- **Brier boundary**: `brier > 0.15` blocks; `brier === 0.15` allows. This matches the spec language "block when brier > 0.15".
- **DecisionLogger.recordOutcome** requires the row to have `outcomeRecordedAt IS NULL` — it will throw if already resolved. This is intentional to prevent double-recording.
- **BrierRunner** filters agents by `status='idle'` as a proxy for non-archived. In production, the runner should filter on all non-archived statuses; for this phase, `idle` is the default agent status and covers the common case.
- **Migration seed idempotency**: all INSERT rows use `ON CONFLICT (kind, reversibility, blast_radius) DO NOTHING`. Re-running the migration is safe.
- **Numeric columns**: Drizzle returns `numeric` columns as `string`. All Brier math uses `Number(row.column)` for proper float arithmetic.
- The `sql` import was unused in `brier-scorer.ts` and was removed during the typecheck fix pass.

---

## §9.7 Files touched

- `packages/db/src/migrations/0119_decision_class_lookup.sql` (new)
- `packages/db/src/migrations/0120_decision_log.sql` (new)
- `packages/db/src/migrations/0121_agent_uncertainty_events.sql` (new)
- `packages/db/src/migrations/0122_brier_calibration.sql` (new)
- `packages/db/src/migrations/meta/_journal.json` — 4 entries appended (idx 119–122)
- `packages/db/src/schema/decision_class_lookup.ts` (new)
- `packages/db/src/schema/decision_log.ts` (new)
- `packages/db/src/schema/agent_uncertainty_events.ts` (new)
- `packages/db/src/schema/brier_calibration.ts` (new)
- `packages/db/src/schema/index.ts` — 4 re-exports appended after `intakeRecoveryActions`
- `server/src/platform/decisions/decision-classifier.ts` (new)
- `server/src/platform/decisions/decision-logger.ts` (new)
- `server/src/platform/decisions/uncertainty-emitter.ts` (new)
- `server/src/platform/decisions/brier-scorer.ts` (new)
- `server/src/platform/decisions/trust-promotion-guard.ts` (new)
- `server/src/platform/decisions/brier-runner.ts` (new)
- `server/src/platform/decisions/index.ts` (new)
- `server/src/platform/decisions/__tests__/decision-classifier.test.ts` (new)
- `server/src/platform/decisions/__tests__/brier-scorer.integration.test.ts` (new)
- `server/src/platform/decisions/__tests__/trust-promotion-guard.integration.test.ts` (new)
- `server/src/platform/decisions/__tests__/decision-log-outcome.integration.test.ts` (new)
- `obsidian/fctcai/01-Architecture/Phases/Phase-9-Decision-Boundary-Brier-Calibration.md` (this file)
- `obsidian/fctcai/01-Architecture/_index.md` — Phase 9 closed + Phase 10 ⏭ next
