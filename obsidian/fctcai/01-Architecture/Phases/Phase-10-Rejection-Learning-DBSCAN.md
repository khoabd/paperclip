# Phase 10 — Rejection Learning + DBSCAN

**Status:** done (Apr 29)
**Owner:** Khoa
**Depends on:** Phase 5 (IntakeStore, FeedbackClusters, IntakeItems), Phase 9 (EntityEmbeddings), Phase 2 (Companies)
**Anchors:** [[../Implementation-Master-Plan#Phase 10]]

## Goal

Build a rejection-learning pipeline that captures every agent rejection with a 14-category taxonomy, clusters semantically similar rejections using DBSCAN over cosine-distance embeddings, and escalates high-frequency patterns to the strategic intake automatically. Closes Phase-5's deferred DBSCAN scope for feedback clustering.

## Non-goals (deferred)

- HTTP routes for rejection dashboard — Phase 15.
- Real cron wiring for clusterer and meta-detector — cron infra ships later; call `clusterRecent()` / `detect()` directly.
- Cross-company rejection pattern analytics — deferred.
- LLM-assisted label generation for cluster centroids — Phase 11+.
- Dismissal and resolution workflows for clusters — Phase 12+.

---

## §10.1 Schema additions

Numbering follows Phase 9 (last migration `0122_brier_calibration`).

### `0123_rejection_events.sql`

Creates `rejection_events` with:
- 14-category CHECK constraint: `wrong_scope`, `missing_context`, `spec_violation`, `design_conflict`, `tech_debt`, `security`, `performance`, `accessibility`, `i18n`, `test_gap`, `docs_gap`, `cost`, `timeline`, `other`
- FKs to `companies` (cascade), `approvals` (set null), `missions` (set null), `intake_items` (set null), `entity_embeddings` (set null)
- `payload jsonb DEFAULT '{}'` for structured metadata (feature_key, component_path, etc.)
- Two indexes: `(company_id, category, occurred_at)` and `(approval_id)`

### `0124_rejection_clusters.sql`

Creates `rejection_clusters` with:
- `member_event_ids uuid[] NOT NULL DEFAULT '{}'` — array of constituent rejection event IDs
- `status` CHECK: `open | escalated | resolved | dismissed`
- `auto_action text` — policy decision (e.g. `escalate_to_intake`, `adjust_prompt`, `tighten_qa`)
- `escalated_to_intake_id uuid` FK → `intake_items`
- Index: `(company_id, status, last_recomputed_at)`

### `0125_rejection_taxonomy.sql`

Creates `rejection_taxonomy` with unique `category` column and seeds 17 rows covering all 14 categories plus security sub-categories (`auth`, `injection`, `supply_chain`) and `other/meta_repeat`. Uses `ON CONFLICT (category) DO NOTHING` for idempotency.

---

## §10.2 Services (`server/src/rejection/`)

### `rejection-store.ts` — `RejectionStore`

Single `record()` method. All DML uses `db.execute(sql\`INSERT INTO rejection_events...\`)` with ISO string timestamps (`::timestamptz` cast) to avoid postgres.js binary-mode type serialization errors on unregistered tables.

### `dbscan-clusterer.ts` — `DBSCANClusterer` + `computeCentroid`

Pure DBSCAN implementation (~70 lines, no external deps):
- Cosine distance: `1 - dot(a,b)/(|a|·|b|)`
- Default `eps=0.25`, `minPoints=3`
- Returns `{ assignments: Map<id, clusterIndex>, noiseIds: Set<id> }`

### `auto-action-policy.ts` — `AutoActionPolicy`

Pure policy function (no DB). Rules:
- `size >= 5` AND category in `{spec_violation, security, design_conflict, performance}` → `escalate_to_intake`
- `security` (any size) → `tighten_security`
- `spec_violation` or `design_conflict` or `test_gap` or `accessibility` → `tighten_qa`
- `wrong_scope` or `missing_context` → `adjust_prompt`
- `cost` or `timeline` → `adjust_velocity`
- `tech_debt` or `performance` or `docs_gap` or `i18n` or `other` → `notify`

### `rejection-clusterer.ts` — `RejectionClusterer`

`clusterRecent(companyId, days=14)` pipeline:
1. Pull rejection events with `embedding_id IS NOT NULL` via raw SQL (ISO string window filter)
2. Pull `entity_embeddings` for those event IDs
3. Run DBSCAN (eps=0.25, minPoints=3)
4. For each cluster: apply `AutoActionPolicy`, upsert/insert `rejection_clusters` via raw SQL
5. Returns `{ eventsProcessed, clustersUpserted }`

All DML on `rejection_clusters` uses `db.execute(sql\`...\`)` — table not in Drizzle registry.

### `meta-rejection-detector.ts` — `MetaRejectionDetector`

`detect(companyId, days=30)`:
1. Pull all clusters in window via raw SQL
2. For each cluster, pull member events and extract `feature_key` / `component_path` from `payload`
3. Count distinct cluster IDs per extracted key
4. If `count >= 3`: write a `category='other', sub_category='meta_repeat', severity=4` rejection event via `RejectionStore.record()`
5. Returns `{ metaRowsWritten, repeatedKeys }`

### `intake-promotion-bridge.ts` — `IntakePromotionBridge`

`promoteCluster(clusterId)`:
1. Fetch cluster via raw SQL, guard against non-`open` status
2. Fetch member events for spec summary
3. Call `IntakeStore.create()` (Phase-5, unmodified) with `type='strategic_input'`, `source='auto_promoted'`, `sourceRef=clusterId`
4. Update cluster `status='escalated'`, `escalated_to_intake_id` via raw SQL
5. Returns `{ intakeId, clusterId }`

Throws `"Cluster … is already escalated"` on double-promote.

### `feedback-clusterer.ts` — `FeedbackClusterer`

Closes Phase-5 deferred scope. `clusterFeedback(companyId, days=30)`:
- Queries `intake_items` WHERE `type LIKE 'feedback%'` via Drizzle ORM (registered table)
- Joins `entity_embeddings` for those items
- Runs DBSCAN (eps=0.25, minPoints=3)
- Upserts `feedback_clusters` (registered table) — 50% overlap threshold for matching existing clusters
- Uses `sql\`now()\`` for `updatedAt` in updates to avoid Date serialization issues

### `index.ts`

Barrel re-exports all service classes, types, and constants.

---

## §10.3 Drizzle schema files (NOT yet added to `schema/index.ts`)

| File | Export |
|------|--------|
| `packages/db/src/schema/rejection_events.ts` | `rejectionEvents`, `REJECTION_CATEGORIES`, `RejectionCategory` |
| `packages/db/src/schema/rejection_clusters.ts` | `rejectionClusters` |
| `packages/db/src/schema/rejection_taxonomy.ts` | `rejectionTaxonomy` |

**Orchestrator must merge** — see §10.5 for exact lines.

---

## §10.4 Tests

All tests in `server/src/rejection/__tests__/`:

| File | Type | Count | Gate criterion |
|------|------|-------|----------------|
| `dbscan-clusterer.test.ts` | unit | 10 | 3 clusters + 2 noise correctly classified |
| `auto-action-policy.test.ts` | unit | 20 | threshold boundary, category-specific actions |
| `rejection-clusterer.integration.test.ts` | integration | 4 | 10 events → cluster ≥5 → `escalate_to_intake` → `intake_items` row |
| `meta-rejection-detector.integration.test.ts` | integration | 4 | 3 clusters same feature_key → meta row written |
| `feedback-clusterer.integration.test.ts` | integration | 4 | 4 similar items → cluster formed |

Integration tests use `startEmbeddedPostgresTestDatabase` + `applyPhase10Tables()` helper to bootstrap tables in a fresh postgres instance. All 350 tests pass (36 test files).

---

## §10.5 Orchestrator merge instructions

### `packages/db/src/migrations/meta/_journal.json`

Append after the `0122_brier_calibration` entry (idx 122):

```json
{
  "idx": 123,
  "version": "7",
  "when": 1777305266999,
  "tag": "0123_rejection_events",
  "breakpoints": true
},
{
  "idx": 124,
  "version": "7",
  "when": 1777305267999,
  "tag": "0124_rejection_clusters",
  "breakpoints": true
},
{
  "idx": 125,
  "version": "7",
  "when": 1777305268999,
  "tag": "0125_rejection_taxonomy",
  "breakpoints": true
}
```

### `packages/db/src/schema/index.ts`

Append at the end of the file:

```typescript
export * from "./rejection_events.js";
export * from "./rejection_clusters.js";
export * from "./rejection_taxonomy.js";
```

### `obsidian/fctcai/_index.md` (Phase Status table)

Add row:

```
| Phase 10 | Rejection Learning + DBSCAN | done | Apr 29 |
```

---

## §10.6 Key design decisions

**Why raw SQL for rejection_events / rejection_clusters DML?**
postgres.js binary-mode serialization: when a table is not exported from `schema/index.ts`, Drizzle's `mapToDriverValue()` does not run for timestamp columns. Passing a JavaScript `Date` object directly to postgres.js then triggers `"The 'string' argument must be of type string — Received an instance of Date"`. The fix is universal: use `.toISOString()` + `::timestamptz` cast in all `db.execute(sql\`...\`)` calls.

**Why DBSCAN over k-means?**
Rejections do not have a known cluster count ahead of time. DBSCAN discovers clusters of arbitrary shape and naturally marks low-density noise points without forcing them into a cluster. eps=0.25 cosine distance targets ~80% semantic similarity.

**Why minPoints=3 for meta-detection threshold?**
Two matching clusters can be coincidence; three independent clusters pointing at the same feature_key is a statistically meaningful signal warranting human review. Matches the gate criterion in the Phase-10 spec.
