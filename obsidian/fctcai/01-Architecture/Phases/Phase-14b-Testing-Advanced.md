# Phase 14b — Testing: Advanced

**Status:** done (Apr 29)
**Owner:** Khoa
**Depends on:** Phase 14a (test_runs primitive, PRGateScorer API style)
**Anchors:** [[../Testing-and-Quality-Assessment-Capability]] · [[../Implementation-Master-Plan#Phase 14b]]

## Goal

Extend the testing capability with 4 advanced dimensions: mobile native (Appium-shaped, injected callbacks), cross-device viewport matrix (BrowserStack-shaped device class mapping), i18n locale matrix + pseudo-locale stress, and UX heuristic LLM-as-Judge. All external I/O (Appium, BrowserStack, LLM) is injected as callbacks; tests use deterministic stubs.

## Non-goals (deferred)

- Real Appium session execution — adapter wiring.
- Real BrowserStack API burst — adapter wiring.
- Real LLM calls for UX judge — adapter wiring.
- HTTP routes for testing dashboards — Phase 15.
- Cron wiring for synthetic probes — Phase 14c.
- Fuzz, persona-driven, synthetic probe dimensions — Phase 14c.

---

## §14b.1 Schema additions

Numbering follows Phase 14a (last migration `0140_cross_browser_results`).

### `0141_mobile_test_runs.sql`

```
mobile_test_runs
 - id uuid pk default gen_random_uuid()
 - test_run_id uuid not null fk test_runs (cascade)
 - platform text not null           -- ios|android
 - device_model text not null
 - os_version text not null
 - screenshot_uri text
 - video_uri text
 - status text not null default 'passed'  -- passed|failed|errored
 - appium_session_id text
 - created_at timestamptz default now() not null
 - check (platform in ('ios','android'))
 - check (status in ('passed','failed','errored'))
```

### `0142_cross_device_results.sql`

```
cross_device_results
 - id uuid pk default gen_random_uuid()
 - test_run_id uuid not null fk test_runs (cascade)
 - device_class text not null       -- mobile|tablet|desktop|wide_desktop
 - viewport text not null
 - browser text not null
 - screenshot_uri text
 - status text not null default 'passed'  -- passed|failed|errored
 - diff_pixel_count integer
 - created_at timestamptz default now() not null
 - check (device_class in ('mobile','tablet','desktop','wide_desktop'))
 - check (status in ('passed','failed','errored'))
 - index (test_run_id, device_class)
```

### `0143_i18n_violations.sql`

```
i18n_violations
 - id uuid pk default gen_random_uuid()
 - test_run_id uuid not null fk test_runs (cascade)
 - locale text not null
 - kind text not null              -- untranslated|truncation|date_format|number_format|rtl_overlap|pluralization
 - target_selector text not null
 - expected_text text
 - actual_text text
 - severity text not null          -- minor|moderate|serious|critical
 - created_at timestamptz default now() not null
 - check (kind in (...))
 - check (severity in ('minor','moderate','serious','critical'))
```

### `0144_ux_judge_scores.sql`

```
ux_judge_scores
 - id uuid pk default gen_random_uuid()
 - test_run_id uuid not null fk test_runs (cascade)
 - dimension text not null          -- clarity|hierarchy|consistency|affordance|feedback|accessibility|delight
 - score numeric(5,2) not null
 - reasoning text
 - screenshot_uri text
 - model text not null
 - created_at timestamptz default now() not null
 - check (dimension in (...))
```

---

## §14b.2 Services

`server/src/testing-advanced/`

```
mobile-test-store.ts          MobileTestStore — record(testRunId, input), listByTestRun(testRunId)
cross-device-matrix.ts        CrossDeviceMatrix — runMatrix(testRunId, { route, devices[], screenshotter })
i18n-validator.ts             I18nValidator — runLocaleMatrix(testRunId, { locales[], domSnapshot, translator })
ux-heuristic-judge.ts         UXHeuristicJudge — judge(testRunId, screenshot, dom, llmCallback)
advanced-pr-gate-scorer.ts    AdvancedPRGateScorer — scoreForPR(prRef) → { blocked, score, weakDimensions }
index.ts                      barrel re-export (no HTTP routes)
__tests__/
  mobile-test-store.integration.test.ts          (integration, 4 tests)
  cross-device-matrix.integration.test.ts        (integration, 2 tests)
  i18n-validator.integration.test.ts             (integration, 4 tests)
  ux-heuristic-judge.integration.test.ts         (integration, 3 tests)
  advanced-pr-gate-scorer.integration.test.ts    (integration, 5 tests)
```

---

## §14b.3 Service design notes

### MobileTestStore

- `record(testRunId, input)` inserts a `mobile_test_runs` row with the provided Appium session metadata (URIs + session id). Status defaults to `passed`.
- `listByTestRun(testRunId)` returns all rows for a given test run id.
- Real Appium execution lives in a separate adapter; this store is fully testable with stub inputs.

### CrossDeviceMatrix

- `runMatrix(testRunId, { route, devices[], screenshotter })` iterates over `DeviceSpec[]`.
- For each device: calls injected `screenshotter` → if `diffPixelCount > 1000` → status=`failed`, else `passed`; if screenshotter throws → status=`errored`.
- Persists one `cross_device_results` row per device.
- `classifyViewport(viewport)` maps pixel widths to `mobile/tablet/desktop/wide_desktop` (BrowserStack device class convention).
- Real BrowserStack injection lives in a separate adapter.

### I18nValidator

- `runLocaleMatrix(testRunId, { locales[], domSnapshot, translator })` iterates locales × DOM elements.
- **untranslated**: element text matches `key.like.pattern` regex → record violation with `kind='untranslated'`.
- **truncation**: `element.isOverflowing === true` → record violation with `kind='truncation'`.
- **pseudo-locale stress** (`pseudoLocaleStress: true`): adds a `pseudo` locale run using `pseudoLocalizeMutation()` (accent substitution + 1.4× padding). Longer text triggers `truncation` violations with `severity='minor'`.
- `pseudoLocalizeMutation(text)` is exported for unit testing.

### UXHeuristicJudge

- `judge(testRunId, screenshot, dom, llmCallback)` calls the injected `llmCallback` with `{ screenshot, dom }`.
- LLM contract: returns `LLMJudgeDimensionResult[]` — one per dimension.
- Persists each into `ux_judge_scores` with the injected `model` name.
- Returns `{ rows, averageScore }`.
- Real LLM call lives in adapter; tests use a deterministic mock returning all 7 dimensions.

### AdvancedPRGateScorer

- `scoreForPR(prRef)` pulls all `test_runs` for the PR.
- Computes `aggregateScore = sum(scores) / count`.
- Block criteria (ANY triggers block):
  - Any dimension `score < 60`.
  - Any `mobile_test_runs.status IN ('failed','errored')` on a `mobile` test run for this PR.
  - Any `cross_device_results.diff_pixel_count > 1000` on a `cross_device` run.
  - Any `i18n_violations.severity = 'critical'` on an `i18n` run.
  - Any `ux_judge_scores.score < 50` on a `ux_judge` run.
- Returns `{ blocked, score, weakDimensions[] }`.

---

## §14b.4 Tests

| Test file | Type | Count | What it proves |
|---|---|---|---|
| `mobile-test-store.integration.test.ts` | integration | 4 | record+list; default status; multi-record scope; run isolation |
| `cross-device-matrix.integration.test.ts` | integration | 2 | 4 devices all passed; one wide_desktop diff>1000→failed |
| `i18n-validator.integration.test.ts` | integration | 4 | 1 key×3 locales→3 violations; truncation from isOverflowing; pseudo-locale 1.4×; clean DOM→0 |
| `ux-heuristic-judge.integration.test.ts` | integration | 3 | 7 dims→7 rows+avg; numeric parse; empty LLM→0 rows |
| `advanced-pr-gate-scorer.integration.test.ts` | integration | 5 | critical i18n+mobile fail→blocked; all clean→not blocked; ux<50→blocked; cd diff>1000→blocked; no runs→not blocked |

**Total new tests: 18.**

---

## §14b.5 Gate criteria

- [x] Migrations `0141`–`0144` created; journal entries (idx 141–144) documented below.
- [x] 4 Drizzle schemas created (`mobile_test_runs.ts`, `cross_device_results.ts`, `i18n_violations.ts`, `ux_judge_scores.ts`).
- [x] MobileTestStore: record → listByTestRun returns it; status defaults to passed.
- [x] CrossDeviceMatrix: 4 devices × 1 viewport → 4 results; one diff>1000 → status=failed.
- [x] I18nValidator: 3 locales × 1 key → 3 untranslated violations; pseudo-locale mutation ≥ 1.4×.
- [x] UXHeuristicJudge: 7 dimensions mock → 7 ux_judge_scores rows; averageScore ≈ 75.57.
- [x] AdvancedPRGateScorer: 1 critical i18n + 1 mobile failed → blocked=true, weakDimensions includes both.
- [x] All previous suites green across dev-flow/, platform/, intake/, greenfield/, rejection/, kb/, cross-repo/, testing-foundation/, testing-advanced/.
- [x] Phase doc `Phases/Phase-14b-Testing-Advanced.md` created (this file).

---

## §14b.6 Implementation notes

- **Subpath imports**: schemas are NOT in `packages/db/src/schema/index.ts` (parallel build constraint). Services import via `@paperclipai/db/schema/<table>`; tests use `db.execute(sql\`DELETE FROM <table>\`)` for cleanup.
- **CrossDeviceMatrix injection**: `screenshotter` is call-site injected, not constructor-injected, so the runner can be instantiated once and called with different screenshotters per test.
- **I18nValidator pseudo-locale**: `pseudoLocalizeMutation` is exported and tested independently. The `pseudo` locale is injected into the locales array when `pseudoLocaleStress=true`.
- **UXHeuristicJudge LLM contract**: The `llmCallback` signature `(input: LLMJudgeInput) => Promise<LLMJudgeDimensionResult[]>` is the integration point for real LLM adapters. Mock in tests returns all 7 heuristic dimensions deterministically.
- **AdvancedPRGateScorer vs PRGateScorer**: These are independent classes; they share the same return type shape `{ blocked, score, weakDimensions }` for API consistency, but AdvancedPRGateScorer only queries 14b tables. Cross-device runs use dimension=`cross_browser` in `test_runs` (the check constraint's allowed values include `cross_browser` but not `cross_device`); the scorer filters by `cross_browser` when querying `cross_device_results`.
- **Multi-workspace test isolation**: each test uses a distinct `issuePrefix` (`MB*`, `CD*`, `I1*`, `UX*`, `AG*`) to prevent unique-constraint collisions.
- **`inArray` from drizzle-orm**: used in AdvancedPRGateScorer to filter `mobile_test_runs.status IN ('failed','errored')`.

---

## §14b.7 Files touched

- `packages/db/src/migrations/0141_mobile_test_runs.sql` (new)
- `packages/db/src/migrations/0142_cross_device_results.sql` (new)
- `packages/db/src/migrations/0143_i18n_violations.sql` (new)
- `packages/db/src/migrations/0144_ux_judge_scores.sql` (new)
- `packages/db/src/schema/mobile_test_runs.ts` (new)
- `packages/db/src/schema/cross_device_results.ts` (new)
- `packages/db/src/schema/i18n_violations.ts` (new)
- `packages/db/src/schema/ux_judge_scores.ts` (new)
- `server/src/testing-advanced/mobile-test-store.ts` (new)
- `server/src/testing-advanced/cross-device-matrix.ts` (new)
- `server/src/testing-advanced/i18n-validator.ts` (new)
- `server/src/testing-advanced/ux-heuristic-judge.ts` (new)
- `server/src/testing-advanced/advanced-pr-gate-scorer.ts` (new)
- `server/src/testing-advanced/index.ts` (new)
- `server/src/testing-advanced/__tests__/mobile-test-store.integration.test.ts` (new)
- `server/src/testing-advanced/__tests__/cross-device-matrix.integration.test.ts` (new)
- `server/src/testing-advanced/__tests__/i18n-validator.integration.test.ts` (new)
- `server/src/testing-advanced/__tests__/ux-heuristic-judge.integration.test.ts` (new)
- `server/src/testing-advanced/__tests__/advanced-pr-gate-scorer.integration.test.ts` (new)
- `obsidian/fctcai/01-Architecture/Phases/Phase-14b-Testing-Advanced.md` (this file)

---

## §14b.8 Exact journal entries (idx 141–144)

```json
{
  "idx": 141,
  "version": "7",
  "when": 1777391680999,
  "tag": "0141_mobile_test_runs",
  "breakpoints": true
},
{
  "idx": 142,
  "version": "7",
  "when": 1777391681999,
  "tag": "0142_cross_device_results",
  "breakpoints": true
},
{
  "idx": 143,
  "version": "7",
  "when": 1777391682999,
  "tag": "0143_i18n_violations",
  "breakpoints": true
},
{
  "idx": 144,
  "version": "7",
  "when": 1777391683999,
  "tag": "0144_ux_judge_scores",
  "breakpoints": true
}
```

## §14b.9 Schema index export lines (for when index.ts is unlocked)

```typescript
export * from "./mobile_test_runs.js";
export * from "./cross_device_results.js";
export * from "./i18n_violations.js";
export * from "./ux_judge_scores.js";
```

## §14b.10 _index.md closed-phase entry

```
| Phase 14b | Testing: Advanced | done | Apr 29 | mobile native, cross-device, i18n, UX heuristic LLM-as-Judge |
```
