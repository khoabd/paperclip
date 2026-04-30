# Phase 12 — Cross-Repo Coordination

**Status:** done (Apr 30)
**Owner:** Khoa
**Depends on:** Phase 9 (BrierScorer, brier_calibration, decision_log), Phase 11 (KB, kb_repositories)
**Anchors:** [[../Cross-Repo-Coordination-and-Decision-Hardening]] · [[../Implementation-Master-Plan#Phase 12]]

## Goal

Introduce the cross-repo coordination primitive layer: a saga orchestrator for distributed atomic operations with compensation, a contract registry for API/event/schema evolution tracking, a vector-clock auditor for knowledge-consistency staleness detection, and a per-repo Brier calibration scorer that slices Phase 9 decision quality by repository.

## Non-goals (deferred)

- HTTP routes for saga/contract/clock status dashboards — Phase 15.
- Cron wiring for `staleAudit` — the function ships; scheduler infra deferred.
- Full cross-repo release train integration (train_id FK) — Phase 13.
- LangGraph orchestrator for multi-repo deploy order — Phase 13.
- Automation Mode hardening (§5 of design doc) — deferred.

---

## §12.1 Schema additions

Numbering follows Phase 11 (last migration `0132_code_symbols`).

### `0133_sagas.sql`

```
sagas
 - id uuid pk default gen_random_uuid()
 - company_id uuid not null fk companies (cascade)
 - name text not null
 - status text not null default 'running'     -- running|compensating|done|aborted
 - started_at timestamptz default now() not null
 - finished_at timestamptz
 - outcome text
 - payload jsonb not null default '{}'
 - created_at timestamptz default now() not null
 - check (status in ('running','compensating','done','aborted'))
 - index (company_id, status, started_at)
```

### `0134_saga_steps.sql`

```
saga_steps
 - id uuid pk default gen_random_uuid()
 - saga_id uuid not null fk sagas (cascade)
 - sequence integer not null
 - name text not null
 - status text not null default 'pending'     -- pending|running|done|failed|compensated
 - forward_action jsonb
 - compensate_action jsonb
 - started_at timestamptz
 - finished_at timestamptz
 - error text
 - check (status in ('pending','running','done','failed','compensated'))
 - unique (saga_id, sequence)
```

### `0135_contract_versions.sql`

```
contract_versions
 - id uuid pk default gen_random_uuid()
 - company_id uuid not null fk companies (cascade)
 - repo_id uuid fk kb_repositories (set null)
 - kind text not null                          -- api|event|schema|protocol
 - name text not null
 - version text not null
 - schema_hash text
 - deprecated_at timestamptz
 - deprecated_for text
 - created_at timestamptz default now() not null
 - check (kind in ('api','event','schema','protocol'))
 - unique (company_id, kind, name, version)
```

### `0136_vector_clocks.sql`

```
vector_clocks
 - id uuid pk default gen_random_uuid()
 - company_id uuid not null fk companies (cascade)
 - scope text not null
 - scope_id text not null
 - clock jsonb not null default '{}'
 - last_updated_at timestamptz default now() not null
 - unique (company_id, scope, scope_id)
```

---

## §12.2 Services

`server/src/cross-repo/`

```
saga-orchestrator.ts     SagaOrchestrator.start() + tick() — pure state-machine + DB writes
contract-registry.ts     ContractRegistry.register() + deprecate() + findActive()
vector-clock-auditor.ts  VectorClockAuditor.bump() + compare() + staleAudit()
per-repo-brier.ts        PerRepoBrier.computeForRepo() — slices brier_calibration by repo
index.ts                 barrel re-export (no HTTP routes)
__tests__/
  saga-orchestrator.integration.test.ts       (integration, 3 tests)
  contract-registry.integration.test.ts       (integration, 5 tests)
  vector-clock-auditor.integration.test.ts    (integration, 11 tests)
  per-repo-brier.integration.test.ts          (integration, 4 tests)
```

---

## §12.3 Service design notes

### SagaOrchestrator

- `start(companyId, name, steps[], payload?)` — inserts `sagas` row (`status=running`) + ordered `saga_steps` rows (`status=pending`).
- `tick(sagaId)` — finds the next `pending` step, marks it `running`, calls the injected `runner` callback.
  - **Success**: marks step `done`. If all steps done → saga `done` with `outcome=success`.
  - **Failure**: marks step `failed` with error text → flips saga to `compensating` → calls injected `compensator` on all previously-`done` steps in **REVERSE** sequence order → marks each `compensated` → saga `aborted`.
- Both `runner` and `compensator` are injected callbacks (no HTTP calls in service layer), making the orchestrator fully testable without I/O stubs.
- `tick` on an already `done|aborted` saga is a no-op.

### ContractRegistry

- `register(input)` — idempotent via `(company_id, kind, name, version)` unique index check before insert.
- `deprecate(id, replacementName)` — sets `deprecated_at = now()` + `deprecated_for = replacementName`. Throws if id not found.
- `findActive(kind, name)` — returns all rows with `deprecated_at IS NULL` for that kind+name.

### VectorClockAuditor

- `bump(companyId, scope, scopeId, node)` — upserts clock row, increments `clock[node]`. Returns updated map.
- `compare(a, b)` — pure function, no DB.
  - `before`: ∀ node: a[node] ≤ b[node], ∃ strict <.
  - `after`: ∀ node: b[node] ≤ a[node], ∃ strict <.
  - `concurrent`: neither dominates (including equal clocks).
- `staleAudit(companyId)` — returns clocks with `last_updated_at < now() - 2h`.

### PerRepoBrier

- Queries `decision_log` rows within `windowDays` with resolved outcomes.
- Filters by `payload->>'repo_id' = repoId` in JS (avoids raw SQL jsonb operators for portability).
- Persists `brier_calibration` row with `scope='repo'`, `scope_id=repoId`.
- Reuses Phase 9 `brier_calibration` table — no new migration needed.

---

## §12.4 Tests

| Test file | Type | Count | What it proves |
|---|---|---|---|
| `saga-orchestrator.integration.test.ts` | integration | 3 | Happy path (3 steps → done); failure path (step 2 fails → step 1 compensated → aborted); tick on done is no-op |
| `contract-registry.integration.test.ts` | integration | 5 | Register new; idempotent re-register; deprecate v1→ findActive returns only v2; deprecate unknown throws; findActive empty when all deprecated |
| `vector-clock-auditor.integration.test.ts` | integration | 11 | bump creates row; bump increments; bump multi-node; compare before/after/concurrent (6 pure cases); staleAudit >2h; staleAudit empty when fresh |
| `per-repo-brier.integration.test.ts` | integration | 4 | Brier ≈ 0.065 with 40 rows; n=0 when no rows; window exclusion; pending rows excluded |

**Total new tests: 23. Full suite: 404/404 green.**

---

## §12.5 Gate criteria ✅

- [x] Migrations `0133`–`0136` created; journal entries (idx 133–136) documented below.
- [x] 4 Drizzle schemas created (`sagas.ts`, `saga_steps.ts`, `contract_versions.ts`, `vector_clocks.ts`).
- [x] Saga happy path: 3 steps run forward → all `done`, saga `status=done`.
- [x] Saga failure path: step 2 fails → step 1 compensates in REVERSE order → saga `aborted`.
- [x] ContractRegistry: register v1 → deprecate v1 → register v2 → findActive returns only v2.
- [x] VectorClock: bump + compare returns `before`/`after`/`concurrent` correctly (6 pure cases).
- [x] PerRepoBrier: 40 rows with `payload.repo_id` → Brier ≈ 0.065 (±0.001).
- [x] All previous suites green: 404/404 across `dev-flow/`, `platform/`, `intake/`, `greenfield/`, `rejection/`, `kb/`, `cross-repo/`.
- [x] Phase doc `Phases/Phase-12-Cross-Repo-Coordination.md` created (this file).

---

## §12.6 Implementation notes (post-build)

- **Subpath imports required**: Phase 12 schemas are not yet in `packages/db/src/schema/index.ts` (parallel build constraint — DO NOT touch that file). Services import via `@paperclipai/db/schema/<table>` subpath; tests use `db.execute(sql\`DELETE FROM <table>\`)` for cleanup rather than `db.delete(tableRef)` to avoid Drizzle's unregistered-table issue.
- **PerRepoBrier payload filter**: jsonb `payload->>'repo_id'` filtering is done in JS post-query. This is correct for Phase 12 scope; a future phase can add a DB-side index on the payload key for performance.
- **VectorClockAuditor.compare**: equal clocks (all values identical) return `concurrent` — there is no causal predecessor relationship between two processes at the same logical time.
- **SagaOrchestrator compensation order**: only steps in `done` status at the time of failure are compensated (not the failed step itself). Compensation runs REVERSE by `sequence`.
- **Contract FK to kb_repositories**: `repo_id` is `SET NULL` on delete, making the FK safe even if the KB phase tables aren't applied yet in environments running migrations selectively.

---

## §12.7 Files touched

- `packages/db/src/migrations/0133_sagas.sql` (new)
- `packages/db/src/migrations/0134_saga_steps.sql` (new)
- `packages/db/src/migrations/0135_contract_versions.sql` (new)
- `packages/db/src/migrations/0136_vector_clocks.sql` (new)
- `packages/db/src/schema/sagas.ts` (new)
- `packages/db/src/schema/saga_steps.ts` (new)
- `packages/db/src/schema/contract_versions.ts` (new)
- `packages/db/src/schema/vector_clocks.ts` (new)
- `server/src/cross-repo/saga-orchestrator.ts` (new)
- `server/src/cross-repo/contract-registry.ts` (new)
- `server/src/cross-repo/vector-clock-auditor.ts` (new)
- `server/src/cross-repo/per-repo-brier.ts` (new)
- `server/src/cross-repo/index.ts` (new)
- `server/src/cross-repo/__tests__/saga-orchestrator.integration.test.ts` (new)
- `server/src/cross-repo/__tests__/contract-registry.integration.test.ts` (new)
- `server/src/cross-repo/__tests__/vector-clock-auditor.integration.test.ts` (new)
- `server/src/cross-repo/__tests__/per-repo-brier.integration.test.ts` (new)
- `obsidian/fctcai/01-Architecture/Phases/Phase-12-Cross-Repo-Coordination.md` (this file)
