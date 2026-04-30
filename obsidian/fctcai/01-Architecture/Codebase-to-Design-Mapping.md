---
tags: [architecture, mapping, implementation]
date: 2026-04-29
status: foundational — read before any implementation work
---

# Codebase-to-Design Mapping

> **Critical:** Custom Paperclip design (22 obsidian docs) is an **EXTENSION layered on top of paperclip's existing control plane** — not a rewrite. This doc maps every design concept → existing paperclip primitive (extend) OR net-new (build).

## 1. Big Picture

Paperclip (clone từ `khoabd/paperclip`) đã có:
- ~70+ DB tables (companies, agents, issues, approvals, sprints, releases, plugins, heartbeat_runs với watchdog, feedback, document_embeddings...)
- ~50 REST routes (companies, agents, issues, approvals, sprints, projects, environments, document-rag, plugins, dashboard...)
- Drizzle ORM + embedded PGlite + Postgres support
- Adapter system (process / http / external plugins) cho agent runtime
- Plugin framework (plugin-loader, sandbox, capability validator, manifest, lifecycle)
- React + Vite UI với company-scoped routing

→ **Estimate:** ~60% của design đã có primitive trong paperclip, ~40% là net-new.

## 2. Naming Conventions — Decision

| Design term | Paperclip term | Decision |
|---|---|---|
| Workspace | `companies` (V1) / `projects` | **Map: design "workspace" = paperclip "company"**. Per `doc/PRODUCT.md`, company is first-order. Multiple projects per company OK. |
| Mission | `issues` | Direct map. Issue = mission. |
| Agent | `agents` | Direct map. |
| Capability | `agent_capabilities` (implicit in adapter_config) | Need new `capabilities` registry table. |
| Skill | `company_skills` | Already exists; need versioning + canary fields. |
| Tool | `plugins` (extensions) + `adapters` | Existing pattern fits. |
| Brain | `documents` (key=`brain`) | Use existing document model. |
| Signal | (none) | **Net-new** `signals` table. |
| Intake | (none — issues are agent/board-created only) | **Net-new** `intake_items` + 6 supporting tables. |
| Approval (Confirm/Choose/Edit/Decide pattern) | `approvals` + `issue_approvals` | Extend with `proposal_pattern`, `proposal_payload`, `confidence`. |
| Train | `releases` | Extend with `feature_key`, cross-repo binding. |
| Sprint | `sprints` + `sprint_issues` | Already exists — map directly. |

## 3. Per-design-doc → existing primitive

### Paperclip-Platform-Workspace-Mission-Model
| Design item | Paperclip primitive | Action |
|---|---|---|
| 3-layer model (Platform/Workspace/Mission) | Deployment-instance / company / issue | **Map** — already aligned conceptually |
| `companies` table | `companies` exists | **Extend**: add `autonomy_level`, `weekly_gate_quota`, `weekly_drag_in_minutes`, `cost_forecast_p50/p90`, `last_autonomy_change_at` |
| Skill registry | `company_skills` + `plugins` | **Extend** `company_skills`: add `version`, `canary_status`, `brier_score`, `rejection_rate_7d`, `auto_demote_threshold` |
| `quota_preemption_events` | (none) | **New table** |
| `apply_template()` (sandbox/startup-experimental/default/regulated-fintech) | (none) | **New service** + 4 default templates |
| Workspace cost forecast | (none) | **New table** `workspace_cost_forecast` |
| WFQ scheduler | Existing scheduler in `server/services/scheduler` | **Extend** — add quota preemption logic |

### Autonomy-Dial-and-Progressive-Trust
| Design item | Paperclip primitive | Action |
|---|---|---|
| 4 autonomy levels (sandbox/low/medium/high) | (none) | **New** column on `companies` + ENUM type |
| Progressive trust counter | (none) | **New** table `trust_counters` keyed by `(company_id, capability_id)` |
| Confidence-driven gating | (none) | **New** `agent_confidence_events` + Brier calibration cron |
| 4 approval patterns (Confirm/Choose/Edit/Decide) | `approvals.payload` JSONB | **Extend** `approvals`: add `proposal_pattern`, `proposal_payload`, `confidence`, `time_to_decision_seconds` |
| Gate quota | (none) | **New** column `weekly_gate_quota` on `companies` |
| Drag-in tracker | (none) | **New** table `human_drag_in_events` |
| Notification batching | (none) | **New** column `notification_batching_policy` on `companies` |

### Autonomous-PM-Strategic-Loop
| Design item | Paperclip primitive | Action |
|---|---|---|
| `signals` table | (none) | **New** |
| `product_signals` source enum (incl. `human_intake`) | (none) | **New** |
| Project Brain | `documents` (key=`brain`) | **Use existing**, add convention `documents.key='brain'` per company |
| Brain snapshots | `document_revisions` | **Use existing** (revisions auto-snapshot) |
| Strategic Loop (LangGraph) | Routines + custom worker | **Decision needed (ADR-0003)**: bring in LangGraph for TS? OR implement as TS state machine using existing routines. Recommendation: **TS state machine** (less dep weight, paperclip is TS not Python) |
| `internal_auditor_runs` | (none) | **New** |
| `outcome_tracker` | (none) | **New** |
| Workspace cost forecast (§11.1) | (none) | **New** |

### Human-Intake-and-Solution-Loop
All 7 tables (intake_items, intake_workflow_states, intake_solutions, intake_timeline_estimates, feedback_clusters, feedback_sentiment, intake_outcome_tracker) are **net-new**. UI: net-new pages.

→ **Sprint estimate**: 4 weeks per Human-Intake §17.

### Self-Healing-and-Liveness
| Design item | Paperclip primitive | Action |
|---|---|---|
| Heartbeat protocol | `heartbeat_runs` + `heartbeat_run_events` | **Already exists** — major win |
| Watchdog service | `heartbeat_run_watchdog_decisions` | **Already exists** — extend rules |
| 6 stuck detection rules | Watchdog has some rules | **Extend** — add cost runaway, deadlock, infinite loop, drag-in (Rule 7) |
| Kill switch (5 levels) | Existing pause/resume/terminate | **Extend** — add cancel-with-checkpoint, cancel-cascade |
| Health score | (computed from existing) | **New** computation logic (no new table) |

### Decision-Boundary-and-Uncertainty-Model
| Design item | Paperclip primitive | Action |
|---|---|---|
| Reversibility × blast-radius matrix | (none) | **New** `decision_class_lookup` config |
| Uncertainty thresholds | (none) | **New** + per-autonomy `AUTONOMY_THRESHOLD_FACTOR` config |
| `decision_log` | `activity_log` covers some, but not decision-specific | **New** dedicated table OR rich activity_log entries |
| Brain snapshots | `document_revisions` | **Use existing** |
| Multi-agent conflict resolution | (none) | **New** workflow on top of existing approvals |

### Cross-Repo-Coordination-and-Decision-Hardening
| Design item | Paperclip primitive | Action |
|---|---|---|
| Saga-style atomic deploy | (none) | **New** orchestrator |
| Contract evolution | (none) | **New** |
| Brier calibration | (none) | **New** nightly cron |
| Vector clock staleness | (none) | **New** |
| Automation Mode hardening | Existing budget hard-stop | **Extend** with `block_trust_promotion` rule |

### Greenfield-Bootstrap
| Design item | Paperclip primitive | Action |
|---|---|---|
| 7-stage pipeline | Could leverage `routines` for orchestration | **New** orchestrator + 7 stage workers |
| 4 human gates | `approvals` | **Use existing** with `proposal_pattern='confirm'` |
| `intake_recovery_actions` | (none) | **New** |
| Stage failure recovery state machine | (none) | **New** |

### Knowledge-Base-Management-Strategy
| Design item | Paperclip primitive | Action |
|---|---|---|
| Multi-repo registry | `projects` (with repo URL field) | **Extend** |
| Tech docs automation | `documents` + `document_embeddings` | **Already exists** — major win |
| RAG index | `document_embeddings` + `document-rag.ts` route | **Already exists** |
| Cold-start bootstrap pipeline | (none) | **New** |
| Coverage audit | (none) | **New** cron |

### Magika-Integration-and-Codebase-Triage
All net-new. Decision needed: which Magika SDK (Python only? Use HTTP shell-out?).

### Rejection-Learning-and-Feedback-Loop
| Design item | Paperclip primitive | Action |
|---|---|---|
| 14-category taxonomy | (none) | **New** ENUM + table |
| DBSCAN clustering | (none) | **New** nightly cron |
| Auto-adjustment (prompt/principle/velocity/rule/QA/security) | (none) | **New** per-target workflows |

### Git-Branch-Tag-Release-Train
| Design item | Paperclip primitive | Action |
|---|---|---|
| Trunk-based + tag promotion | `releases` | **Extend** — add tag conventions, env pointers |
| feature_key threading | (none) | **New** column on `issues` + commit conventions |
| Hotfix worktree | Existing `dev-runner-worktree.ts` | **Extend** |
| Forward-port runner | (none) | **New** cron |

### Testing-and-Quality-Assessment-Capability
All net-new infrastructure. Major investment (3 weeks).

### UX-Strategy-and-Design
Existing UI has many pages. Need to add:
- Intake hub
- Approval Center 4-pattern UI (extend existing approvals)
- Mobile UX for approvals
- "Explain" auditability pattern

### Full-System-Workflow-and-Coordination
This is documentation, not code. Trigger inventory must be cross-checked against `routines` + adapter webhooks during implementation.

### External-Integrations-and-Environment-Strategy
| Design item | Paperclip primitive | Action |
|---|---|---|
| GitLab MCP | `plugins` system supports MCP | **Plugin** |
| OpenSearch MCP | `plugins` | **Plugin** |
| 4-environment model | `environments` | **Already exists** — extend with promotion rules |

## 4. Net-new tables summary

Tổng cộng **~30 tables mới** cần tạo trong suốt 12 phases:

```
Phase 1 (Autonomy + Approval extension):
  - trust_counters
  - agent_capability_matrix
  - human_drag_in_events
  - quota_preemption_events
  - workspace_cost_forecast
  - autonomy_profile_history
  + columns extension trên: companies, approvals, company_skills

Phase 2 (Strategic Loop):
  - signals
  - internal_auditor_runs
  - outcome_tracker
  - sprint_proposals (or extend sprints)
  + brain document convention

Phase 3 (Human Intake):
  - intake_items
  - intake_workflow_states
  - intake_solutions
  - intake_timeline_estimates
  - feedback_clusters
  - feedback_sentiment
  - intake_outcome_tracker

Phase 4 (Self-Healing extension):
  - (extend existing heartbeat_run_watchdog_decisions only)

Phase 5 (Greenfield):
  - greenfield_intakes
  - greenfield_stages
  - intake_recovery_actions
  - personas (could be documents key='persona')

Phase 6 (Decision-Boundary + Brier):
  - decision_class_lookup
  - decision_log
  - agent_uncertainty_events
  - brier_calibration

Phase 7 (Rejection Learning):
  - rejection_events
  - rejection_clusters
  - rejection_taxonomy

Phase 8 (Knowledge Base):
  - kb_repos (extend projects)
  - kb_coverage_gaps
  - kb_doc_staleness

Phase 9 (Cross-Repo):
  - sagas
  - saga_steps
  - contract_versions
  - vector_clocks

Phase 10 (Release Train):
  - feature_keys
  - train_bindings
  - env_pointers

Phase 11 (Testing):
  - test_runs
  - manual_test_cases
  - persona_scenarios
  - synthetic_probe_results
```

## 5. Architectural mismatches needing ADRs

| # | Topic | Options | Recommendation |
|---|---|---|---|
| ADR-0003 | Strategic Loop runtime | (a) LangGraph TS port, (b) Custom TS state machine, (c) Python sidecar | (b) Custom TS — paperclip is TS-first, less deps |
| ADR-0004 | Magika integration | (a) Python sidecar, (b) WASM, (c) Skip Magika use heuristics | (a) Python sidecar via plugin (paperclip plugins support this) |
| ADR-0005 | DBSCAN implementation | (a) `density-clustering` npm, (b) Python sidecar, (c) pgvector + custom SQL | (a) JS lib for V1, swap to Python if needed |
| ADR-0006 | Workspace = company semantics | (a) Direct map, (b) Add `workspace_id` separate from company_id, (c) Subdivide company into multiple workspaces | (a) Direct map for MVP — revisit if 1-company-N-workspace becomes need |
| ADR-0007 | Brain storage | (a) `documents` key='brain', (b) Dedicated `project_brains` table | (a) Use existing — saves table proliferation |
| ADR-0008 | Drag-in detection observation | (a) Git hooks, (b) FS watchers, (c) Self-reported `/dragin` only | (c) for V1, (a) for V2 |

## 6. Reuse impact summary

**Major wins (already exists):**
- ✅ Approval system (extend, don't rewrite)
- ✅ Heartbeat + watchdog (Self-Healing 70% done)
- ✅ Documents + revisions + embeddings (Brain + KB ready)
- ✅ Plugin system (Skills + Tools framework)
- ✅ Adapter system (Skill execution runtime)
- ✅ Routines (cron-like infrastructure for Strategic Loop)
- ✅ Activity log (auditability foundation)
- ✅ Sprints + Releases (extend for Train)
- ✅ Environments (4-env model)
- ✅ Issues + comments + relations (Mission DAG)

**Major builds (net-new):**
- 🔨 Autonomy Dial + Progressive Trust (Phase 1)
- 🔨 Strategic Loop orchestrator (Phase 2)
- 🔨 Human Intake hub (Phase 3)
- 🔨 Greenfield Bootstrap pipeline (Phase 5)
- 🔨 Decision Boundary + Brier (Phase 6)
- 🔨 Rejection Learning + DBSCAN (Phase 7)
- 🔨 Magika triage (Phase 8)
- 🔨 Cross-Repo Saga (Phase 9)

## 7. Mismapping Fixes (post-critical-review, 2026-04-29)

> Independent critic audit (see [[Implementation-Master-Plan]] v2 changelog) found these claims in earlier sections were **wrong or under-specified**. This appendix corrects them. The plan v2 incorporates all fixes.

### 7.1. `documents` table has NO `key` column — ADR-0007 broken as written

**Earlier claim:** "Brain stored as `documents(key='brain')` — zero schema change."
**Reality:** The actual `documents` schema has only `id, companyId, title, format, latestBody, latestRevisionId, latestRevisionNumber, createdByAgentId, createdByUserId, updatedByAgentId, updatedByUserId, createdAt, updatedAt`. No `key`.
**Fix (Phase 0 corrective):** Migration adds `key TEXT` + unique index `(company_id, key) WHERE key IS NOT NULL`. Backfill existing rows with NULL key. ADR-0007 stays valid after this migration.

### 7.2. `approvals` is NOT `approval_items` — fragmentation risk

**Earlier claim:** "Extend `approvals` with proposal_pattern, confidence."
**Reality:** Auto-Ops design specified `approval_items` with risk_score / risk_factors / options / timeout / delegation — structurally different from existing `approvals`.
**Fix:** **ADR-0009 — extend existing `approvals`**, do NOT create `approval_items`. All Auto-Ops fields added as columns or in `metadata` JSONB. Pattern-specific shapes carried in `payload` with Zod discriminated union.

### 7.3. `heartbeat_runs` is a run-LOG, not a live-SIGNAL table

**Earlier claim:** "Heartbeat protocol: `heartbeat_runs` — Already exists — major win."
**Reality:** `heartbeat_runs` records completed runs (with `exitCode`, `signal`, `usageJson`, `resultJson`, `logRef`). It is NOT a stream of liveness pings.
**Fix (Phase 6):** Add new `liveness_heartbeats(id, mission_id, agent_id, state, progress_marker, cost_so_far_usd, current_tool, waiting_on, sent_at)` table. The watchdog rules engine + `heartbeat_run_watchdog_decisions` ARE genuinely reusable; the signal source is what changes.

### 7.4. `company_skills` is too thin for the Skill Library

**Earlier claim:** "`company_skills` — extend with version + canary."
**Reality:** Existing `company_skills` is a per-company key-value with `(companyId, key, name)`. The Skill Library design specifies `version semver`, `code_path`, `input_schema`, `output_schema`, `capability_id`, `status canary|stable|deprecated`, `cost_p50_usd`, `brier_30d`, `rejection_rate_7d` — completely different shape.
**Fix (Phase 2):** Net-new `platform_skills` (catalog) + `skill_versions` (versioned implementations) + `workspace_skill_pins` (per-workspace pinning). Existing `company_skills` stays for legacy use; new code reads `platform_skills` + `workspace_skill_pins`.

### 7.5. Workspace = Company is correct, but isolation primitives are missing

**Earlier claim (ADR-0006):** "Workspace = company. Zero new tables."
**Reality:** ADR-0006's mapping is correct, BUT the Platform-Workspace-Mission design specifies per-workspace isolation primitives that do NOT exist on `companies`: `rag_namespace`, `vault_path`, `pg_schema NULL`, `wfq_weight`, `cost_budget_usd_per_week`. Plus capability-override and lifecycle-event tables.
**Fix (Phase 2):** Extend `companies` with isolation columns + add `workspace_capability_overrides`, `workspace_lifecycle_events`, `workspace_skill_pins`, `mission_cost_events`, `cost_anomalies`, `llm_quota_state`. ADR-0006 still holds (1:1 mapping); Phase 2 builds the missing primitives on top.

### 7.6. Master Architecture Overview drifted from ADR-0003

**Earlier claim:** Master doc Section 7 says "Orchestration: LangGraph + Python", Section 5 glossary says "Strategic Loop = LangGraph supervisor graph", Section 7 also references "Persistence: PostgresSaver", "Tracing: LangSmith".
**Reality:** ADR-0003 chose TS state machine + Drizzle for the new TS codebase. Master doc was not updated.
**Fix (Phase 0 corrective):** Update [[00-Master-Architecture-Overview]] §5 and §7 to reflect ADR-0003. Replace "LangGraph + Python" → "TS state machine (ADR-0003)". Replace "PostgresSaver" → "Drizzle + `strategic_loop_runs/events`". Replace "LangSmith" → "`strategic_loop_events` replay + `decision_log`".

### 7.7. External Integrations had no place in the plan

**Earlier claim:** Implicit assumption that paperclip already has GitLab/OpenSearch/Tavily adapters.
**Reality:** Paperclip has the plugin + adapter framework but NO GitLab/OpenSearch/research adapters shipped. Phase 4 (Strategic Loop signals), Phase 8 (Greenfield repo scaffold), Phase 11 (KB ingestion), Phase 12 (Cross-repo coord) all need them.
**Fix (Phase 1):** Add explicit Phase 1 "External Integrations + MCP Foundation" with adapter scaffolding + 10 GitLab tools + OpenSearch + Tavily/arXiv + embeddings infra (`entity_embeddings` generic table + `embed`/`embedBatch` helpers).

### 7.8. Reuse % is 30-40%, not 60%

**Earlier claim:** "~60% of design has primitives in paperclip."
**Reality:** After column-level audit (7.1-7.7 above), genuinely-reusable primitives are closer to 30-40% by table count and even less by feature surface.
**Fix:** Stop quoting the 60% figure. Use this honest split:
- ✅ **Genuine reuse** (~35%): approvals (extend), documents (after `key` migration), document_revisions, document_embeddings, plugins, plugin_jobs, agents, sprints, releases, environments, heartbeat_run_watchdog_decisions (rules engine), routines, company_secrets, activity_log, issues + comments
- 🟡 **Partial reuse** (~25%): heartbeat_runs (log only — need new liveness table), company_skills (legacy only — need new platform_skills), companies (extend with isolation + autonomy)
- 🔨 **Net-new** (~40%): Platform/Workspace/Mission layer, Strategic Loop runtime + signals, Human Intake (7 tables), Greenfield (3 tables), Decision Boundary + Brier (4 tables), Rejection Learning (3 tables), Magika triage, Saga + cross-repo, Release Train + feature_keys, MCP servers + tool invocations, design_docs lifecycle, feature_flags, 16-dim test infrastructure

### 7.9. Hidden cost summary — see Master Plan v2 changelog

The earlier mapping doc glossed: embeddings infra, mobile UX (RN), agent prompt versioning, observability for Custom Paperclip itself, migration scripts, RBAC for new endpoints, secrets rotation. All accounted for in [[Implementation-Master-Plan]] v2.

---

## 8. Liên kết

- [[Implementation-Master-Plan]] — phased delivery roadmap (v2)
- [[ADR-0003-Strategic-Loop-Runtime]]
- [[ADR-0006-Workspace-Equals-Company]]
- [[ADR-0007-Brain-Storage]]
- [[ADR-0009-Approvals-Architecture]]
- [[Paperclip-Platform-Workspace-Mission-Model]] — design source
- [[Autonomy-Dial-and-Progressive-Trust-Design]]
- [[Human-Intake-and-Solution-Loop-Design]]
- [[Self-Healing-and-Liveness-Design]]
- All other design docs in this folder
