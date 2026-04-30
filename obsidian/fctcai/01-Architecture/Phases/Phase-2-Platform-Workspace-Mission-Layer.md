# Phase 2 — Platform / Workspace / Mission Layer

**Status:** in_progress
**Window:** 4-6 weeks
**Last updated:** 2026-04-29
**Prereqs:** Phase 1 ✅

> **Goal:** The structural foundation for multi-project support. Without it, 30 concurrent projects in 12.5h/week is impossible. The slogan is **"Workspace = company; Platform is its own slice; Mission is the cost-bearing unit."**

---

## 1. Architecture decisions reused

- **Workspace = company** (per ADR-0006). No new `workspaces` table — extend `companies`.
- **Brain = documents row** (per ADR-0007). Same Brain access pattern in workspace context.
- **Approvals = single table** (per ADR-0009). Workspace context routes approvals to `approvals` directly.

---

## 2. Schema additions

### 2.1 Platform-singleton tables (no `company_id`)

| Table | Migration | Purpose |
| --- | --- | --- |
| `capability_registry` | `0079` | What an agent CAN do (`code-write`, `repo-scan`, `chaos-trigger`, …); risk tier, default autonomy mode |
| `platform_agents` | `0080` | Catalog of agent archetypes (`pm`, `engineer`, `qa`, …) — name, default model, role |
| `platform_skills` | `0081` | Skill catalog rows (key, name, kind, capability_id, runtime) |
| `skill_versions` | `0082` | Per-skill semver track with canary status, cost_p50, brier_30d, rejection_rate_7d |
| `platform_tools` | `0083` | Tool registry — bridges to `mcp_servers` (Phase 1) and JSON schema |
| `cross_workspace_learning` | `0084` | Patterns observed across workspaces; `(kind, key)` unique |

### 2.2 Workspace primitives — extend `companies` (`0085`)

```
ALTER TABLE companies ADD COLUMN autonomy_level         text         NOT NULL DEFAULT 'sandbox';
ALTER TABLE companies ADD COLUMN wfq_weight             integer      NOT NULL DEFAULT 100;
ALTER TABLE companies ADD COLUMN cost_budget_usd_per_week numeric(12,4) NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN rag_namespace          text;
ALTER TABLE companies ADD COLUMN vault_path             text;
ALTER TABLE companies ADD COLUMN pg_schema              text;
```

`autonomy_level` ∈ `sandbox|low|medium|high` (Phase 3 widens semantics).

### 2.3 Workspace satellite tables

| Table | Migration | Purpose |
| --- | --- | --- |
| `workspace_capability_overrides` | `0086` | Per-workspace override of `capability_registry.default_mode` with reason + expiry |
| `workspace_lifecycle_events` | `0087` | Append-only log of `created/paused/resumed/budget_increased/skill_pinned/...` |
| `workspace_skill_pins` | `0088` | Pin a workspace to a specific `skill_versions.version` (overrides canary routing) |

### 2.4 Mission cost attribution tables

| Table | Migration | Purpose |
| --- | --- | --- |
| `mission_cost_events` | `0089` | Every LLM call's cost — `(company_id, mission_id NULL, agent_id, model, tokens_in, tokens_out, cost_usd)` |
| `cost_anomalies` | `0090` | Detected spikes / runaway burn — `(company_id, kind, threshold, actual, status)` |
| `llm_quota_state` | `0091` | Rolling weekly quota per workspace |

---

## 3. Services (`server/src/platform/`)

```
server/src/platform/
├─ index.ts                  # Platform singleton accessor
├─ Platform.ts               # registry façade: getAgent / getSkill / getTool / capability(...)
├─ AgentPool.ts              # checkOut / release; cost-tracked
├─ SkillLibrary.ts           # semver lookup + canary routing (deterministic by hash)
├─ ToolRegistry.ts           # MCP tool wrapper with schema validation
├─ WfqScheduler.ts           # weighted-fair-queue across workspaces (in-memory; cron 30s)
├─ CostAttributor.ts         # event listener → mission_cost_events
└─ WorkspaceContext.ts       # per-workspace scope (DB query, brain, RAG namespace, quota gate)
```

### 3.1 WFQ scheduling
Pick the next workspace to run by **deficit-weighted lottery**: keep an in-memory `deficit[companyId]`; each tick subtract `weight` from the pick winner's deficit. Used by every cron-driven loop in subsequent phases.

### 3.2 Canary routing rule
For a skill with `status='canary'` plus a sibling `status='stable'`:
- if `workspace_skill_pins` row exists → pinned version wins.
- else compute `hash(companyId + key) mod 100`; route to canary if `< canary_pct` (default 5).

### 3.3 Cost attribution invariants
- One `mission_cost_events` row per LLM call. **Never** two for the same `(model_call_id)` (idempotency key on the row).
- `cost_usd` ≥ 0; tokens ≥ 0.
- Background sweeper aggregates → `llm_quota_state` weekly bucket.
- Anomaly detector: if 1-hour spend > 3× same-workspace 7-day median → emit `cost_anomalies` row.

---

## 4. APIs

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/platform/agents` | catalog |
| GET | `/api/platform/skills` | catalog |
| GET | `/api/platform/tools` | catalog |
| GET | `/api/platform/capabilities` | catalog |
| GET | `/api/workspaces` | alias to GET /companies |
| GET | `/api/workspaces/:id/quota` | current week quota state |
| POST | `/api/workspaces/:id/capability-override` | set override |
| GET | `/api/workspaces/:id/cost?window=7d` | spend rollup |

---

## 5. UI (deferred to Phase 7 polish)
Phase 2 ships data + APIs only. Platform Console + per-workspace dashboard land in Phase 7.

---

## 6. Tests

| Layer | Subject | Where |
| --- | --- | --- |
| Schema | All 13 new tables round-trip + cascade rules | `server/src/__tests__/platform-schema.test.ts` |
| Schema | `companies` new columns default + nullable behaviour | `server/src/__tests__/companies-extensions.test.ts` |
| Unit | `WfqScheduler` fairness across N=10 workspaces | `server/src/platform/__tests__/wfq-scheduler.test.ts` |
| Unit | `SkillLibrary` canary routing deterministic + pin overrides | `server/src/platform/__tests__/skill-library.test.ts` |
| Unit | `CostAttributor` idempotency + quota rollup | `server/src/platform/__tests__/cost-attributor.test.ts` |
| Unit | `WorkspaceContext` scopes brain + quota correctly | `server/src/platform/__tests__/workspace-context.test.ts` |

---

## 7. Gate (must pass before Phase 3)

1. Migrations `0079-0091` clean (`pnpm db:check:migrations`).
2. WFQ test: 10 workspaces with weights `[100, 100, 100, 200, 200, 50, 50, 50, 50, 100]` over 1000 picks ⇒ each gets within ±5% of expected share.
3. Canary routing: same `(companyId, skillKey)` always lands on the same version (deterministic).
4. Cost attributor: 100 concurrent simulated LLM calls ⇒ exactly 100 rows, no duplicates; quota rollup matches sum.
5. Anomaly detector: synthetic 4× spike triggers `cost_anomalies` row.
6. Workspace context: brain access for workspace A never reads workspace B's documents.

---

## 8. Out of scope
- pg-schema-per-workspace isolation (column reserved; activation deferred to Phase 12 if needed).
- Hot-reload of skill versions (manual restart for now).
- Multi-region / replication.
- Cost forecasting (just historical; predictive in Phase 9).

---

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| WFQ in-memory state lost on restart | Deficits checkpointed to a tiny `wfq_state` row every 30s |
| Cost double-counting under crash | Idempotency key + reconciliation cron |
| Canary routing flake on hash collision | Use FNV-1a over `${companyId}:${skillKey}` — same primitive as embeddings/mock |
| Service surface explosion | All services reachable through `Platform` singleton; tests assert no direct DB import outside platform/ |
