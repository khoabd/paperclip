# Phase 11 — Knowledge Base + Magika

**Status:** done (Apr 29)
**Owner:** Khoa
**Depends on:** Phase 5 (IntakeStore, L2 deferred scope), Phase 9 (entity_embeddings FK), Phase 10 (rejection_clusters schema style)
**Anchors:** [[../Knowledge-Base-Management-Strategy]] · [[../Magika-Integration-and-Codebase-Triage]] · [[../Implementation-Master-Plan#Phase 11]]

## Goal

Bootstrap the Knowledge Base subsystem: 7 tables covering repository registry, document store, chunk store, coverage gaps, staleness scoring, Magika file inventory, and code symbols. Provide a complete cold-start bootstrap pipeline (Magika → triage → document upsert → chunking → coverage audit), and close the Phase 5 deferred L2 timeline estimator backfill using Monte Carlo over historical intakes.

## Non-goals (deferred)

- HTTP routes for KB query or bootstrap trigger — Phase 15.
- Real tree-sitter native bindings — regex heuristic fallback ships; real tree-sitter deferred.
- Optic/TypeSpec API spec extractor — Phase 12.
- Embedding pipeline wiring — embedding agent reads unembedded chunks; Phase 13.
- PR webhook handler — Phase 12/13.
- Security scan (Magika `suspicious` bucket alerting) — Phase 13.
- RAG query API — Phase 15.

---

## §11.1 Schema additions

Migration range: `0126`–`0132`. All tables land in default schema.

### `0126_kb_repositories.sql`

```
kb_repositories
 - id uuid pk default gen_random_uuid()
 - company_id uuid not null fk companies (cascade)
 - repo_url text not null
 - name text not null
 - default_branch text
 - primary_language text
 - status text not null default 'pending'   -- pending|indexing|indexed|stale|error
 - last_indexed_at timestamptz
 - magika_inventory_id uuid
 - created_at timestamptz default now() not null
 - unique (company_id, repo_url)
 - index (company_id, status)
```

### `0127_kb_documents.sql`

```
kb_documents
 - id uuid pk
 - company_id uuid not null fk companies (cascade)
 - repo_id uuid not null fk kb_repositories (cascade)
 - kind text not null    -- code|api_spec|adr|readme|design|persona
 - path text not null
 - language text
 - sha text
 - body text
 - summary text
 - last_modified_at timestamptz
 - embedding_id uuid fk entity_embeddings (set null)
 - status text not null default 'fresh'   -- fresh|stale|deprecated
 - created_at timestamptz default now() not null
 - updated_at timestamptz default now() not null
 - unique (repo_id, path)
```

### `0128_kb_chunks.sql`

```
kb_chunks
 - id uuid pk
 - document_id uuid not null fk kb_documents (cascade)
 - chunk_index int not null
 - body text not null
 - symbol text
 - language text
 - embedding_id uuid fk entity_embeddings (set null)
 - token_count int
 - created_at timestamptz default now() not null
 - unique (document_id, chunk_index)
 - index (document_id, symbol)
```

### `0129_kb_coverage_gaps.sql`

```
kb_coverage_gaps
 - id uuid pk
 - company_id uuid not null fk companies (cascade)
 - repo_id uuid not null fk kb_repositories (cascade)
 - kind text                    -- missing_readme|missing_adr|missing_api_spec|stale_doc|orphan_doc
 - target_path text
 - severity int
 - suggested_action text
 - status text not null default 'open'
 - detected_at timestamptz default now() not null
 - resolved_at timestamptz
```

### `0130_kb_doc_staleness.sql`

```
kb_doc_staleness
 - id uuid pk
 - document_id uuid not null fk kb_documents (cascade)
 - score numeric(5,4) not null
 - reason text
 - last_check_at timestamptz default now() not null
 - unique (document_id)
```

### `0131_magika_inventory.sql`

```
magika_inventory
 - id uuid pk
 - repo_id uuid not null fk kb_repositories (cascade)
 - file_path text not null
 - magika_label text not null
 - confidence numeric(5,4) not null
 - is_vendored bool not null default false
 - is_generated bool not null default false
 - is_binary bool not null default false
 - captured_at timestamptz default now() not null
 - unique (repo_id, file_path)
 - index (repo_id, magika_label)
```

### `0132_code_symbols.sql`

```
code_symbols
 - id uuid pk
 - document_id uuid not null fk kb_documents (cascade)
 - kind text not null    -- function|class|interface|type|enum|const
 - name text not null
 - signature text
 - start_line int
 - end_line int
 - parent_symbol_id uuid fk code_symbols (set null)  -- self-referential
 - embedding_id uuid fk entity_embeddings (set null)
 - created_at timestamptz default now() not null
 - index (document_id, kind)
```

---

## §11.2 Services

`server/src/kb/`

```
magika-inventory.ts      MagikaInventoryService — wraps MagikaClient; MockMagikaClient for tests
tree-sitter-chunker.ts   TreeSitterChunker — regex heuristic + line-window fallback (pure, no native deps)
kb-document-store.ts     KBDocumentStore — createDoc, chunk, markStale, linkEmbedding
kb-cold-start-bootstrap.ts   KBColdStartBootstrap — 5-stage bootstrap pipeline
kb-coverage-auditor.ts   KBCoverageAuditor — audit, listGaps, resolveGap
kb-staleness-scorer.ts   KBStalenessScorer — scoreDoc (age + referencing heuristic)
pr-gate-kb-updater.ts    PRGateKBUpdater — onPRMerged stub (Phase 12 wires to real webhook)
l2-timeline-estimator.ts L2TimelineEstimator — Monte Carlo over historical intakes; closes Phase 5
index.ts                 barrel re-export (no HTTP routes)
__tests__/
  tree-sitter-chunker.test.ts                       (unit, pure, 17 tests)
  kb-cold-start-bootstrap.integration.test.ts       (integration, 4 tests)
  kb-coverage-auditor.integration.test.ts           (integration, 5 tests)
  l2-timeline-estimator.integration.test.ts         (integration, 5 tests)
```

---

## §11.3 ColdStart Bootstrap pipeline (5 stages)

```
Stage 1 — Magika inventory
  MagikaInventoryService.inventory(repoId, files)
  → magika_inventory rows (upsert by repo_id + file_path)

Stage 2 — Triage
  Filter: !isVendored && !isGenerated && !isBinary
          && (source_labels | doc_labels | config_labels)

Stage 3 — Document upsert
  KBDocumentStore.createDoc() per triage-passing file
  kind inferred from path (readme / adr / api_spec / design / code)
  → kb_documents rows (upsert by repo_id + path)

Stage 4 — Chunking
  KBDocumentStore.chunk(docId, content, language)
  → TreeSitterChunker → kb_chunks rows (full re-chunk on repeat runs)

Stage 5 — Coverage audit (stub for embed)
  KBCoverageAuditor.audit(repoId, companyId)
  → kb_coverage_gaps rows
  Embedding: deferred to Phase 13 embedding agent

Returns BootstrapSummary { filesIndexed, chunkCount, gaps }
```

---

## §11.4 L2 Timeline Estimator (Phase 5 deferred scope)

- Pulls `intake_items` + `intake_outcome_tracker` for same company + type where `actual_days IS NOT NULL`.
- Runs 1000 Monte Carlo samples: base drawn from historical pool; factors `complexity ~ U(0.8,1.5)`, `velocity ~ U(0.7,1.3)`, `autonomy ~ U(0.9,1.1)`.
- Falls back to type-based prior (feature_request→10d, bug_report→3d, etc.) when no historical data.
- Persists via `IntakeStore.addTimelineEstimate({ level: 'L2', source: 'monte_carlo' })`.
- Phase 5 code (`intake-timeline-l1.ts`, `intake-store.ts`) is **not modified** — the L2 estimator is additive only.

---

## §11.5 Tests

| Test file | Type | Count | What it proves |
|---|---|---|---|
| `tree-sitter-chunker.test.ts` | unit | 17 | TS/JS/Python/Go patterns; arrow-fn ordering; window fallback; line numbers |
| `kb-cold-start-bootstrap.integration.test.ts` | integration | 4 | 5-file synthetic repo → magika_inventory + kb_documents + kb_chunks; README=readme kind; gaps detected; idempotency |
| `kb-coverage-auditor.integration.test.ts` | integration | 5 | missing_readme detected; all 3 structural gaps on code-only repo; no false positive when readme exists; stale_doc gap; resolveGap |
| `l2-timeline-estimator.integration.test.ts` | integration | 5 | L2 row written with source=monte_carlo; prior fallback when no history; p90>=p50; throws on unknown intake; probabilistic range check |

**Total new tests: 31.**

---

## §11.6 Gate criteria

- [x] 7 migrations written (`0126`–`0132`).
- [x] 7 Drizzle schemas written (separate files, not touching index.ts).
- [x] Tree-sitter chunker unit tests: 17/17 green.
- [x] ColdStartBootstrap integration: 5-file synthetic repo → magika_inventory, kb_documents, kb_chunks materialize; idempotent.
- [x] CoverageAuditor finds missing_readme on a repo missing README.
- [x] L2TimelineEstimator: seed 5 historical intakes → estimate → L2 row with source='monte_carlo'.
- [x] No Phase 5 code modified (zero regression risk on intake suite).
- [x] `Phases/Phase-11-Knowledge-Base-Magika.md` created (this file, status `done (Apr 29)`).

---

## §11.7 Implementation notes

- **Magika sidecar**: `MagikaClient` interface (path ADR-0004). `MockMagikaClient` uses extension-to-label lookup for tests. Real sidecar plugged in via constructor injection in production.
- **TreeSitterChunker**: Arrow-function patterns ordered before generic `const` pattern to avoid misclassification. Regex heuristic is good enough for chunking granularity — real tree-sitter will replace it in Phase 13 without changing the `SymbolChunk` interface.
- **Schema imports**: new schemas imported directly from `@paperclipai/db/schema/<file>` subpaths (not via `schema/index.ts`) so tests work before orchestrator appends the exports.
- **Upsert strategy**: `magika_inventory` and `kb_documents` both use `onConflictDoUpdate` keyed on their unique constraint — bootstrap re-runs are idempotent.
- **kb_doc_staleness**: uses `onConflictDoUpdate` keyed on `document_id` (unique) — re-scoring is idempotent.
- **Monte Carlo determinism**: uses `Math.random()` — tests use probabilistic assertions (`p90 >= p50`, range bounds) not exact values.
- **code_symbols self-FK**: `parent_symbol_id` references `code_symbols(id)` — Drizzle doesn't support self-referential `.references()` cleanly so the FK is defined in SQL only; the Drizzle schema stores it as a plain `uuid` column. The SQL migration adds the FK constraint.

---

## §11.8 Files written

- `packages/db/src/migrations/0126_kb_repositories.sql` (new)
- `packages/db/src/migrations/0127_kb_documents.sql` (new)
- `packages/db/src/migrations/0128_kb_chunks.sql` (new)
- `packages/db/src/migrations/0129_kb_coverage_gaps.sql` (new)
- `packages/db/src/migrations/0130_kb_doc_staleness.sql` (new)
- `packages/db/src/migrations/0131_magika_inventory.sql` (new)
- `packages/db/src/migrations/0132_code_symbols.sql` (new)
- `packages/db/src/schema/kb_repositories.ts` (new)
- `packages/db/src/schema/kb_documents.ts` (new)
- `packages/db/src/schema/kb_chunks.ts` (new)
- `packages/db/src/schema/kb_coverage_gaps.ts` (new)
- `packages/db/src/schema/kb_doc_staleness.ts` (new)
- `packages/db/src/schema/magika_inventory.ts` (new)
- `packages/db/src/schema/code_symbols.ts` (new)
- `server/src/kb/magika-inventory.ts` (new)
- `server/src/kb/tree-sitter-chunker.ts` (new)
- `server/src/kb/kb-document-store.ts` (new)
- `server/src/kb/kb-cold-start-bootstrap.ts` (new)
- `server/src/kb/kb-coverage-auditor.ts` (new)
- `server/src/kb/kb-staleness-scorer.ts` (new)
- `server/src/kb/pr-gate-kb-updater.ts` (new)
- `server/src/kb/l2-timeline-estimator.ts` (new)
- `server/src/kb/index.ts` (new)
- `server/src/kb/__tests__/tree-sitter-chunker.test.ts` (new)
- `server/src/kb/__tests__/kb-cold-start-bootstrap.integration.test.ts` (new)
- `server/src/kb/__tests__/kb-coverage-auditor.integration.test.ts` (new)
- `server/src/kb/__tests__/l2-timeline-estimator.integration.test.ts` (new)
- `obsidian/fctcai/01-Architecture/Phases/Phase-11-Knowledge-Base-Magika.md` (this file)
