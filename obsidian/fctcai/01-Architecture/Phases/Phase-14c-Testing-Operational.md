# Phase 14c — Testing: Operational

**Status:** done (Apr 29)
**Owner:** Khoa
**Depends on:** Phase 14b (testing-advanced, test_runs primitive, PRGateScorer API style)
**Anchors:** [[../Testing-and-Quality-Assessment-Capability]] · [[../Implementation-Master-Plan#Phase 14c]]

## Goal

Extend the testing capability with 4 operational dimensions: property-based fuzz (hand-rolled with shrinking), persona-driven NL E2E scenarios (Hercules-style DSL), production synthetic probes (5 min cron on prod, this service handles record/read only), and manual test case fallback (mobile UX for testers). A combined `OperationalPRGateScorer` integrates all 4 signals into a single PR gate decision.

## Non-goals (deferred)

- Real fastcheck / fast-check library integration — the hand-rolled LCG fuzzer is production-sufficient; real adapter wiring is Phase 15.
- Hercules NL E2E runtime — runner callback is injected; real execution lives in a separate adapter.
- Cron wiring for synthetic probes — the runner exposes `recordResult` only; cron adapter is Phase 15.
- HTTP routes for Test Case Browser UI — Phase 15.
- Manual TC submission from mobile React Native — Phase 15.

---

## §14c.1 Schema additions

Numbering follows Phase 14b (last migration `0144_ux_judge_scores`).

### `0145_manual_test_cases.sql`

```
manual_test_cases
 - id uuid pk default gen_random_uuid()
 - company_id uuid not null fk companies (cascade)
 - mission_id uuid fk missions (set null)
 - title text not null
 - body text
 - assigned_to_user_id text
 - status text not null default 'pending'   -- pending|in_progress|passed|failed|skipped
 - result text
 - evidence_uri text
 - dimension text not null                  -- manual_tc|persona|exploratory
 - created_by_user_id text
 - created_at timestamptz default now() not null
 - completed_at timestamptz
 - check (status in ('pending','in_progress','passed','failed','skipped'))
 - check (dimension in ('manual_tc','persona','exploratory'))
 - index (company_id, status)
 - index (assigned_to_user_id, status)
```

### `0146_persona_scenarios.sql`

```
persona_scenarios
 - id uuid pk default gen_random_uuid()
 - company_id uuid not null fk companies (cascade)
 - persona_slug text not null
 - scenario_text text not null
 - expected_outcome text
 - hercules_dsl jsonb
 - last_run_test_run_id uuid fk test_runs (set null)
 - status text not null default 'active'    -- active|archived
 - created_at timestamptz default now() not null
 - check (status in ('active','archived'))
```

### `0147_synthetic_probe_results.sql`

```
synthetic_probe_results
 - id uuid pk default gen_random_uuid()
 - company_id uuid not null fk companies (cascade)
 - probe_name text not null
 - env text not null                        -- dev|stag|live
 - status text not null                     -- passed|failed|degraded
 - latency_ms integer
 - error_text text
 - screenshot_uri text
 - occurred_at timestamptz default now() not null
 - check (env in ('dev','stag','live'))
 - check (status in ('passed','failed','degraded'))
 - index (company_id, env, occurred_at)
 - index (probe_name, status, occurred_at)
```

### `0148_fuzz_run_summaries.sql`

```
fuzz_run_summaries
 - id uuid pk default gen_random_uuid()
 - test_run_id uuid not null fk test_runs (cascade)
 - target text not null
 - total_runs integer not null
 - failures integer not null
 - shrunk_failures integer not null
 - seed text
 - summary jsonb not null default '{}'
 - created_at timestamptz default now() not null
```

---

## §14c.2 Services

`server/src/testing-operational/`

```
property-fuzz-runner.ts       PropertyFuzzRunner — runProperty(...), listByTestRun(testRunId)
persona-scenario-store.ts     PersonaScenarioStore — register(...), runScenario(id, runner, testRunId), get(id), listActive(companyId)
synthetic-probe-runner.ts     SyntheticProbeRunner — recordResult(input), recentForEnv(companyId, env, lookbackMin)
manual-test-case-store.ts     ManualTestCaseStore — create(input), assign(id, userId), submitResult(id, result, evidenceUri), fetch(id), listByCompany(companyId)
operational-pr-gate-scorer.ts OperationalPRGateScorer — scoreForPR(prRef, companyId) → { blocked, score, weakDimensions }
index.ts                      barrel re-export (no HTTP routes)
__tests__/
  property-fuzz-runner.integration.test.ts          (integration, 3 tests)
  persona-scenario-store.integration.test.ts        (integration, 4 tests)
  synthetic-probe-runner.integration.test.ts        (integration, 3 tests)
  manual-test-case-store.integration.test.ts        (integration, 6 tests)
  operational-pr-gate-scorer.integration.test.ts    (integration, 6 tests)
```

---

## §14c.3 Service design notes

### PropertyFuzzRunner

- Hand-rolled LCG-based RNG (`makeLcgRng`). Deterministic given a seed string.
- Generator interface: `gen<T>(rng: Rng, depth: number) => T`. Depth passed to allow recursive generators to limit size.
- On property failure: `shrinkInputs` iterates up to 100 rounds, halving each value in turn (numbers: `trunc(v/2)`; strings: `slice(0, len/2)`; arrays: `slice(0, len/2)`). Stops when no further shrink still fails.
- Persists one `fuzz_run_summaries` row per `runProperty` call, including up to 10 failure samples with both original and shrunk inputs.
- Block threshold: `failures / totalRuns > 0.03` (3%) — evaluated by `OperationalPRGateScorer`.

### PersonaScenarioStore

- `register` stores the Hercules DSL payload as `jsonb`; no validation of DSL shape (shape is adapter-defined).
- `runScenario(id, runner, testRunId)` calls the injected `runner(herculesDsl)`, then unconditionally updates `last_run_test_run_id`. The runner's `passed` boolean is returned but not persisted separately — the gate scorer reads the linked `test_run.status` to determine pass/fail.
- Real Hercules execution lives in a separate adapter; tests use `async () => ({ passed: true })`.

### SyntheticProbeRunner

- Write-only service from the perspective of the production cron — `recordResult` is the single ingestion point.
- `recentForEnv(companyId, env, lookbackMin)` computes the cutoff as `Date.now() - lookbackMin * 60 * 1000` and returns results ordered desc by `occurred_at`.
- The `occurredAt` field can be overridden for backfilling historical probe data.

### ManualTestCaseStore

- State machine enforced in-process (not a DB constraint): `pending → {in_progress, skipped}`, `in_progress → {passed, failed, skipped}`. Terminal states have no outgoing transitions.
- `assign(id, userId)` is syntactic sugar for `pending → in_progress + set assignedToUserId`.
- `submitResult` sets `completedAt = now()` on all terminal transitions.
- `ManualTCTransitionError` is exported and typed so callers can `instanceof`-check.

### OperationalPRGateScorer

- `scoreForPR(prRef, companyId)` resolves all `test_runs` for the PR, then checks 4 signals independently:
  1. **Fuzz**: `fuzz_run_summaries.failures / total_runs > 0.03` for any run in the PR.
  2. **Persona**: any `persona_scenarios.last_run_test_run_id` pointing to a run for this PR where `test_run.status = 'failed'`.
  3. **Manual TC**: any `manual_test_cases.status = 'failed'` for the company (company-scoped since manual TCs are not directly FK'd to test_runs).
  4. **Synthetic**: any `synthetic_probe_results` for `env=live` within last 30 min with `status IN ('failed','degraded')`.
- Score = `max(0, 100 - 25 * weakDimensions.length)`.
- If no test runs exist for the PR → `{ blocked: false, score: 100, weakDimensions: [] }`.

---

## §14c.4 Tests

| Test file | Type | Count | What it proves |
|---|---|---|---|
| `property-fuzz-runner.integration.test.ts` | integration | 3 | good property → 0 failures; buggy property → failures + shrunk ≤ original; listByTestRun returns all summaries |
| `persona-scenario-store.integration.test.ts` | integration | 4 | register → active; runScenario links last_run; nonexistent id throws; listActive filters |
| `synthetic-probe-runner.integration.test.ts` | integration | 3 | 5 entries → 5 desc-sorted; env filter; lookback window |
| `manual-test-case-store.integration.test.ts` | integration | 6 | create→pending; assign→in_progress; passed with evidence; pending→skipped; pending→passed throws; passed→failed throws |
| `operational-pr-gate-scorer.integration.test.ts` | integration | 6 | fuzz >3%→blocked; fuzz ≤3%→clean; persona failed run→blocked; manual_tc failed→blocked; live synthetic→blocked; all clean→score=100 |

**Total new tests: 22.**

---

## §14c.5 Gate criteria

- [x] Migrations `0145`–`0148` created; journal entries (idx 145–148) documented below.
- [x] 4 Drizzle schemas created (`manual_test_cases.ts`, `persona_scenarios.ts`, `synthetic_probe_results.ts`, `fuzz_run_summaries.ts`).
- [x] PropertyFuzzRunner: good property 100 runs → 0 failures; buggy property → shrunk value ≤ original.
- [x] PersonaScenarioStore: register → run with `passed=true` mock → `last_run_test_run_id` linked.
- [x] SyntheticProbeRunner: 5 entries → `recentForEnv` returns 5 sorted desc.
- [x] ManualTestCaseStore: `pending→passed` throws; `passed→failed` throws; valid transitions persist.
- [x] OperationalPRGateScorer: fuzz >3% → blocked; live synthetic failure → blocked; all clean → score=100.
- [x] All previous suites green: dev-flow/, platform/, intake/, greenfield/, rejection/, kb/, cross-repo/, testing-foundation/, testing-advanced/, testing-operational/ — **457 tests / 58 files passed**.
- [x] Phase doc `Phases/Phase-14c-Testing-Operational.md` created (this file).

---

## §14c.6 Implementation notes

- **Subpath imports**: schemas are NOT in `packages/db/src/schema/index.ts` (parallel build constraint). Services import via `@paperclipai/db/schema/<table>`.
- **Fuzz RNG**: LCG with Numerical Recipes constants (multiplier 1664525, addend 1013904223). `Math.imul` ensures 32-bit integer overflow semantics on all JS engines.
- **Shrinking**: iterative halving is weaker than property-based library shrinking (no type-specific strategies) but sufficient for the gate signal. The smallest reproducer is stored in `summary.failureSamples[].shrunkInputs`.
- **PersonaScenarioStore gate integration**: the scorer reads `test_run.status` rather than a separate `passed` column, keeping the schema minimal.
- **ManualTestCaseStore transition guard**: enforced at the service layer, not a DB trigger. This keeps the schema portable and the guard testable without DB involvement.
- **Multi-workspace test isolation**: each test uses a distinct `issuePrefix` (`FZ*`, `PS*`, `SP*`, `MT*`, `OG*`) to prevent `companies_issue_prefix_idx` unique constraint collisions.
- **`inArray` from drizzle-orm**: used in `OperationalPRGateScorer` for `fuzz_run_summaries`, `persona_scenarios`, and `synthetic_probe_results` multi-id filters.

---

## §14c.7 Files touched

- `packages/db/src/migrations/0145_manual_test_cases.sql` (new)
- `packages/db/src/migrations/0146_persona_scenarios.sql` (new)
- `packages/db/src/migrations/0147_synthetic_probe_results.sql` (new)
- `packages/db/src/migrations/0148_fuzz_run_summaries.sql` (new)
- `packages/db/src/schema/manual_test_cases.ts` (new)
- `packages/db/src/schema/persona_scenarios.ts` (new)
- `packages/db/src/schema/synthetic_probe_results.ts` (new)
- `packages/db/src/schema/fuzz_run_summaries.ts` (new)
- `server/src/testing-operational/property-fuzz-runner.ts` (new)
- `server/src/testing-operational/persona-scenario-store.ts` (new)
- `server/src/testing-operational/synthetic-probe-runner.ts` (new)
- `server/src/testing-operational/manual-test-case-store.ts` (new)
- `server/src/testing-operational/operational-pr-gate-scorer.ts` (new)
- `server/src/testing-operational/index.ts` (new)
- `server/src/testing-operational/__tests__/property-fuzz-runner.integration.test.ts` (new)
- `server/src/testing-operational/__tests__/persona-scenario-store.integration.test.ts` (new)
- `server/src/testing-operational/__tests__/synthetic-probe-runner.integration.test.ts` (new)
- `server/src/testing-operational/__tests__/manual-test-case-store.integration.test.ts` (new)
- `server/src/testing-operational/__tests__/operational-pr-gate-scorer.integration.test.ts` (new)
- `obsidian/fctcai/01-Architecture/Phases/Phase-14c-Testing-Operational.md` (this file)

---

## §14c.8 Exact journal entries (idx 145–148)

```json
{
  "idx": 145,
  "version": "7",
  "when": 1777391684999,
  "tag": "0145_manual_test_cases",
  "breakpoints": true
},
{
  "idx": 146,
  "version": "7",
  "when": 1777391685999,
  "tag": "0146_persona_scenarios",
  "breakpoints": true
},
{
  "idx": 147,
  "version": "7",
  "when": 1777391686999,
  "tag": "0147_synthetic_probe_results",
  "breakpoints": true
},
{
  "idx": 148,
  "version": "7",
  "when": 1777391687999,
  "tag": "0148_fuzz_run_summaries",
  "breakpoints": true
}
```

## §14c.9 Schema index export lines (for when index.ts is unlocked)

```typescript
export * from "./manual_test_cases.js";
export * from "./persona_scenarios.js";
export * from "./synthetic_probe_results.js";
export * from "./fuzz_run_summaries.js";
```

## §14c.10 _index.md closed-phase entry

```
| Phase 14c | Testing: Operational | done | Apr 29 | property fuzz + shrinking, persona NL E2E, synthetic probes, manual TC state machine |
```
