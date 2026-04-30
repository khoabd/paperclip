# Phase 14a — Testing: Foundation

**Status:** done (Apr 29)
**Owner:** Khoa
**Depends on:** Phase 12 (Cross-Repo, vector_clocks), Phase 13 (missions FK target)
**Anchors:** [[../Testing-and-Quality-Assessment-Capability]] · [[../Implementation-Master-Plan#Phase 14a]]

## Goal

Introduce the testing foundation primitive layer: persistent test run tracking, visual screenshot baseline management, axe-core-shaped accessibility violation collection, a cross-browser matrix orchestrator (with injected screenshot/diff callbacks — no real Playwright here), and a PR gate scorer that computes a weighted quality signal and determines hard-block status.

## Non-goals (deferred)

- Real Playwright adapter (screenshot execution) — Phase 14b adapter.
- Real axe-core injection into a live browser — Phase 14b adapter.
- BrowserStack burst integration — Phase 14b.
- Mobile native (Appium), i18n matrix, UX heuristic judge — Phases 14b/14c.
- HTTP routes for test run dashboards — Phase 15.
- Cron wiring for synthetic probes — Phase 14c.

---

## §14a.1 Schema additions

Numbering follows Phase 12 (last migration `0136_vector_clocks`).

### `0137_test_runs.sql`

```
test_runs
 - id uuid pk default gen_random_uuid()
 - company_id uuid not null fk companies (cascade)
 - mission_id uuid fk missions (set null)
 - pr_ref text
 - dimension text not null     -- visual|a11y|cross_browser|mobile|i18n|ux_judge|fuzz|persona_e2e|synthetic|manual_tc
 - status text not null default 'pending'   -- pending|running|passed|failed|errored
 - started_at timestamptz
 - finished_at timestamptz
 - score numeric(5,2)
 - summary jsonb not null default '{}'
 - created_at timestamptz default now() not null
 - check (dimension in (...))
 - check (status in (...))
 - index (company_id, dimension, status, created_at)
 - index (pr_ref)
```

### `0138_visual_baselines.sql`

```
visual_baselines
 - id uuid pk default gen_random_uuid()
 - company_id uuid not null fk companies (cascade)
 - route text not null
 - viewport text not null
 - browser text not null
 - image_uri text not null
 - sha text not null
 - approved_at timestamptz
 - approved_by_user_id text
 - archived bool not null default false
 - created_at timestamptz default now() not null
 - unique index (company_id, route, viewport, browser) WHERE archived = false
```

### `0139_a11y_violations.sql`

```
a11y_violations
 - id uuid pk default gen_random_uuid()
 - test_run_id uuid not null fk test_runs (cascade)
 - rule_id text not null
 - impact text not null     -- minor|moderate|serious|critical
 - target_selector text not null
 - html_snippet text
 - help_url text
 - created_at timestamptz default now() not null
 - check (impact in ('minor','moderate','serious','critical'))
 - index (test_run_id, impact)
```

### `0140_cross_browser_results.sql`

```
cross_browser_results
 - id uuid pk default gen_random_uuid()
 - test_run_id uuid not null fk test_runs (cascade)
 - browser text not null
 - viewport text not null
 - screenshot_uri text
 - diff_pixel_count integer
 - baseline_id uuid fk visual_baselines (set null)
 - status text not null default 'passed'   -- passed|failed|new_baseline_needed
 - created_at timestamptz default now() not null
 - check (status in ('passed','failed','new_baseline_needed'))
```

---

## §14a.2 Services

`server/src/testing-foundation/`

```
test-run-store.ts          TestRunStore — create/markRunning/markPassed/markFailed/listForPR
visual-baseline-store.ts   VisualBaselineStore — register/findActive/archive
a11y-violation-collector.ts A11yViolationCollector — record/summary
cross-browser-runner.ts    CrossBrowserRunner — runMatrix (injected screenshotter + differ)
pr-gate-scorer.ts          PRGateScorer — scoreForPR
index.ts                   barrel re-export (no HTTP routes)
__tests__/
  visual-baseline-store.integration.test.ts   (integration, 4 tests)
  a11y-violation-collector.integration.test.ts (integration, 3 tests)
  cross-browser-runner.integration.test.ts    (integration, 2 tests)
  pr-gate-scorer.integration.test.ts          (integration, 4 tests)
```

---

## §14a.3 Service design notes

### TestRunStore

- `create(input)` inserts a new `test_runs` row with `status=pending`.
- `markRunning(id)` sets `status=running`, `started_at=now()`.
- `markPassed(id, score, summary)` / `markFailed(id, score, summary)` set terminal status + `finished_at`.
- `listForPR(pr_ref)` returns all runs for a given PR ref.

### VisualBaselineStore

- `register(input)` archives any existing active baseline for `(company, route, viewport, browser)` before inserting the new one, maintaining the partial unique index invariant at the application level.
- `findActive(...)` returns the active (non-archived) row or null.
- `archive(id)` flips `archived=true` on the given row.

### A11yViolationCollector

- `record(testRunId, violations[])` bulk-inserts axe-core-shaped violation rows.
- `summary(testRunId)` returns `{ minor, moderate, serious, critical, total }` counts.

### CrossBrowserRunner

- `runMatrix(testRunId, { companyId, route, browsers[], viewports[] })` iterates all browser×viewport cells.
- For each cell: calls injected `screenshotter` → checks active baseline → if none, registers current as new baseline (status=`new_baseline_needed`); if found, calls injected `differ` → status=`failed` when diffPixelCount > 1000, else `passed`.
- Persists one `cross_browser_results` row per cell.
- Real Playwright execution lives in a separate adapter, keeping this service fully testable with stubs.

### PRGateScorer

- `scoreForPR(pr_ref)` pulls all `test_runs` for the PR.
- Computes `aggregateScore = sum(scores) / count`.
- Block criteria (ANY triggers block):
  - Any dimension with `score < 60`
  - Any `a11y_violations` with `impact='critical'` on any a11y run for this PR
  - Any `cross_browser_results.diff_pixel_count > 1000` on any cross_browser run for this PR
- Returns `{ blocked, score, weakDimensions[] }`.

---

## §14a.4 Tests

| Test file | Type | Count | What it proves |
|---|---|---|---|
| `visual-baseline-store.integration.test.ts` | integration | 4 | register→findActive; archive→null; register replaces old; findActive empty when none |
| `a11y-violation-collector.integration.test.ts` | integration | 3 | 5 mixed violations→correct counts; empty record is no-op; summary scoped to run id |
| `cross-browser-runner.integration.test.ts` | integration | 2 | 3×2 matrix→6 new_baseline_needed rows; second run with diff>1000→one failed |
| `pr-gate-scorer.integration.test.ts` | integration | 4 | visual=80/a11y=50+critical/cb=85→blocked; all pass→not blocked; critical alone blocks; no runs→not blocked |

**Total new tests: 13.**

---

## §14a.5 Gate criteria

- [x] Migrations `0137`–`0140` created; journal entries (idx 137–140) documented below.
- [x] 4 Drizzle schemas created (`test_runs.ts`, `visual_baselines.ts`, `a11y_violations.ts`, `cross_browser_results.ts`).
- [x] Visual baseline: register → findActive returns it → archive → findActive returns null.
- [x] A11yViolationCollector: 5 violations of mixed impact → summary returns correct counts.
- [x] CrossBrowserRunner: 3×2 matrix → 6 results; diff>1000 → status=failed.
- [x] PRGateScorer: visual=80/a11y=50+critical/cb=85 → blocked=true, weakDimensions includes a11y.
- [x] All previous suites green across dev-flow/, platform/, intake/, greenfield/, rejection/, kb/, cross-repo/, testing-foundation/.
- [x] Phase doc `Phases/Phase-14a-Testing-Foundation.md` created (this file).

---

## §14a.6 Implementation notes

- **Subpath imports required**: Phase 14a schemas are not in `packages/db/src/schema/index.ts` (parallel build constraint — DO NOT touch that file). Services import via `@paperclipai/db/schema/<table>` subpath; tests use `db.execute(sql\`DELETE FROM <table>\`)` for cleanup.
- **Partial unique index**: The `WHERE archived = false` clause in `visual_baselines` is defined in both the SQL migration and in the Drizzle schema using `.where(sql\`${table.archived} = false\`)`. Application-level archiving in `register()` ensures the invariant is never violated by the app even if the DB constraint is not enforced on archived rows.
- **CrossBrowserRunner injection pattern**: `screenshotter` and `differ` are constructor-injected callbacks, making the runner fully testable without any Playwright or S3 I/O. The test stubs return deterministic URIs and pixel counts.
- **PRGateScorer block logic**: The scorer queries `a11y_violations` and `cross_browser_results` directly — not just aggregate scores — to apply the critical/pixel-diff hard-block rules independent of the numeric score.
- **Multi-workspace test isolation**: Each test uses a distinct `issuePrefix` (`VB*`, `AX*`, `CB*`, `GS*`) to prevent unique-constraint collisions across concurrent test runs.

---

## §14a.7 Files touched

- `packages/db/src/migrations/0137_test_runs.sql` (new)
- `packages/db/src/migrations/0138_visual_baselines.sql` (new)
- `packages/db/src/migrations/0139_a11y_violations.sql` (new)
- `packages/db/src/migrations/0140_cross_browser_results.sql` (new)
- `packages/db/src/schema/test_runs.ts` (new)
- `packages/db/src/schema/visual_baselines.ts` (new)
- `packages/db/src/schema/a11y_violations.ts` (new)
- `packages/db/src/schema/cross_browser_results.ts` (new)
- `server/src/testing-foundation/test-run-store.ts` (new)
- `server/src/testing-foundation/visual-baseline-store.ts` (new)
- `server/src/testing-foundation/a11y-violation-collector.ts` (new)
- `server/src/testing-foundation/cross-browser-runner.ts` (new)
- `server/src/testing-foundation/pr-gate-scorer.ts` (new)
- `server/src/testing-foundation/index.ts` (new)
- `server/src/testing-foundation/__tests__/visual-baseline-store.integration.test.ts` (new)
- `server/src/testing-foundation/__tests__/a11y-violation-collector.integration.test.ts` (new)
- `server/src/testing-foundation/__tests__/cross-browser-runner.integration.test.ts` (new)
- `server/src/testing-foundation/__tests__/pr-gate-scorer.integration.test.ts` (new)
- `obsidian/fctcai/01-Architecture/Phases/Phase-14a-Testing-Foundation.md` (this file)

---

## §14a.8 Exact journal entries (idx 137–140)

```json
{
  "idx": 137,
  "version": "7",
  "when": 1777305280999,
  "tag": "0137_test_runs",
  "breakpoints": true
},
{
  "idx": 138,
  "version": "7",
  "when": 1777305281999,
  "tag": "0138_visual_baselines",
  "breakpoints": true
},
{
  "idx": 139,
  "version": "7",
  "when": 1777305282999,
  "tag": "0139_a11y_violations",
  "breakpoints": true
},
{
  "idx": 140,
  "version": "7",
  "when": 1777305283999,
  "tag": "0140_cross_browser_results",
  "breakpoints": true
}
```

## §14a.9 Schema index export lines (for when index.ts is unlocked)

```typescript
export * from "./test_runs.js";
export * from "./visual_baselines.js";
export * from "./a11y_violations.js";
export * from "./cross_browser_results.js";
```

## §14a.10 _index.md closed-phase entry

```
| Phase 14a | Testing: Foundation | done | Apr 29 | visual regression, a11y, cross-browser primitives |
```
