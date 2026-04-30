---
tags: [implementation, plan, roadmap]
date: 2026-04-29
status: master roadmap v2 — Custom Paperclip on top of paperclip codebase
revision: v2 (post-critical-review)
---

# Implementation Master Plan v2 — Custom Paperclip

> **v2 changelog (2026-04-29):** post-critical-review rewrite.
> - Added Phase 1 (External Integrations + MCP) — was missing entirely
> - Added Phase 2 (Platform/Workspace/Mission Layer) — was missing entirely
> - Added Phase 7 (Development Flow + Feature Flags) — was missing entirely
> - Split Phase 11 testing into 14a/14b/14c (3 wks → 7-9 wks honest)
> - Mobile UX moved out of "polish" into Phase 15 with proper 3-week budget
> - Added integration milestones (Mile-A after Phase 5, MVP-Gate after Phase 8, Mile-B after Phase 11, Full-System-Gate after Phase 15)
> - Honest timeline: **11-15 months solo @ 100%**, **18-24 months part-time**
> - All "reuse existing X" claims audited (see [[Codebase-to-Design-Mapping]] §7 — Mismapping Fixes)

> Phased delivery roadmap. Each phase ships independently behind feature flags. Total: **47-60 weeks solo @ 100%**. MVP at end of Phase 8 (~24-30 weeks).

## North Star (unchanged)
**Goal:** Custom Paperclip = autonomous multi-project AI control plane where **human acts ONLY as gate/approver**, everything else is automated. Target: 30 projects in 12.5h/week of human time.

**Codebase baseline:** Paperclip (`khoabd/paperclip` fork). Custom Paperclip is **extension layered on top**, not rewrite. See [[Codebase-to-Design-Mapping]].

## Two-Gate Strategy

```
Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 ──┐
                                            │
                                       MVP GATE (1-5 projects E2E)
                                            │
       ┌─ 9 → 10 → 11 → 12 → 13 ←──────────┘
       │
       └→ 14a → 14b → 14c → 15 ─→ FULL-SYSTEM GATE (30 projects)
```

- **MVP Gate (after Phase 8, ~24-30 weeks):** Anh chạy được 1-5 dự án thực tế, autonomy/intake/strategic-loop/greenfield đều hoạt động. Đây là điểm có thể "dừng và polish" nếu cần.
- **Full-System Gate (after Phase 15, ~47-60 weeks):** Toàn bộ thiết kế đạt 30 projects @ 12.5h/tuần.

## Phase dependency graph

```
                              ┌── ext-integrations ───┐
                              ↓                       ↓
Phase 0 (foundations) → 1 (MCP) → 2 (Platform) → 3 (Autonomy) ─┬→ 4 (Strategic Loop)
                                                                ├→ 5 (Intake)
                                                                ├→ 6 (Self-Healing)
                                                                └→ 7 (Dev Flow)
                                                                       ↓
                                                                   8 (Greenfield) ── MVP GATE ──
                                                                       │
                                                  9 (Decision/Brier) ←─┤
                                                  10 (Rejection/DBSCAN) ←┤
                                                  11 (KB+Magika) ←──────┤
                                                  12 (Cross-Repo) ←─────┤
                                                  13 (Release Train) ←──┘
                                                       │
                                                  14a/b/c (Testing) → 15 (UX/Hardening) → FULL-SYSTEM GATE
```

---

## Phase 0 — Foundation Audit + ADRs (1 week — 90% done)

**Output:** [[Codebase-to-Design-Mapping]] ✅, ADRs 0003-0008 ✅, master plan v2 ✅, **plus 4 corrective items** below.

**Remaining tasks:**
- ⬜ ADR-0009: Approvals Architecture (extend `approvals` vs new `approval_items`) — **decision: extend existing `approvals`**
- ⬜ Migration: add `documents.key TEXT` column + unique `(company_id, key)` index — prereq cho ADR-0007 brain
- ⬜ Update [[00-Master-Architecture-Overview]] — remove LangGraph/Python/LangSmith refs (replaced by ADR-0003 TS state machine)
- ⬜ Update [[Codebase-to-Design-Mapping]] §7 — "Mismapping Fixes" appendix

**Gate:** All 4 corrective items merged + reviewed.

---

## Phase 1 — External Integrations + MCP Foundation (2-3 weeks) **[NEW]**

**Goal:** Build the bridge to outside world. Without this, Phase 4 (Strategic Loop signals), Phase 8 (Greenfield repo scaffolding), Phase 11 (KB + Magika repo access), Phase 12 (Cross-repo) are all blocked.

**Schema:**
- `mcp_servers(id, company_id NULL, name, kind, endpoint, auth_secret_id FK, status, config_json, last_health_at)`
- `mcp_tool_invocations(id, mcp_server_id, tool_name, request_json, response_json, duration_ms, error, occurred_at)` — for audit
- Reuse `company_secrets` + `company_secret_versions` for tokens

**Adapters:**
- `packages/adapters/mcp-base/` — generic MCP client + retry + circuit breaker
- `packages/adapters/gitlab-mcp/` — create branch, push commit, open MR, read pipeline status, list files (~10 tools)
- `packages/adapters/opensearch-mcp/` — query logs, evaluate alert rules
- `packages/adapters/research-mcp/` — Tavily + arXiv search

**Embeddings infra:**
- Verify `pgvector` extension on PGlite + Postgres
- `packages/shared/src/embeddings/` — `embed(text)` + `embedBatch(texts)` with `text-embedding-3-small`
- Generic embedding pipeline: `(entity_type, entity_id, content) → row in entity_embeddings`
- New: `entity_embeddings(entity_type, entity_id, embedding vector(1536), embedded_at)` — supports rejection/feedback/intake later

**API:**
- `GET/POST /companies/:id/mcp-servers`
- `POST /mcp/:id/health-check`
- `POST /mcp/:id/invoke` (admin/test only; production callers use SDK)

**UI:**
- Settings → Integrations tab: add/edit/test MCP servers
- Per-MCP health badge

**Tests:**
- Unit: MCP base client (retry, circuit breaker, auth)
- Integration: GitLab MCP against test project (CI uses fake GitLab)
- Smoke: embedding round-trip < 500ms

**Gate:** GitLab MCP creates a branch + opens an MR end-to-end against a sandbox repo; OpenSearch MCP returns log-search results; embedding pipeline produces vectors for sample text.

---

## Phase 2 — Platform/Workspace/Mission Layer (4-6 weeks) **[NEW — was MISSING entirely]**

**Goal:** The structural foundation for multi-project support. Without this, the 30-project target is impossible.

**Schema (Platform-singleton — no `company_id`):**
- `platform_agents(id, name, role, default_model, prompt_template_key, status)` — catalog
- `platform_skills(id, key, name, kind, capability_id, runtime, default_model, status)` — skill catalog
- `platform_tools(id, key, name, mcp_server_id, schema_json)` — tool registry
- `capability_registry(id, name, default_mode, risk_tier, brier_window_days, owner)` — what an agent can do
- `skill_versions(id, skill_id, version semver, code_path, input_schema, output_schema, status canary|stable|deprecated, cost_p50_usd, brier_30d, rejection_rate_7d, released_at)`
- `cross_workspace_learning(id, kind, key, payload, observed_count, last_observed_at)` — pattern store

**Schema (Workspace = company, with isolation primitives):**
- Extend `companies`: `autonomy_level` (used by Phase 3), `wfq_weight INT DEFAULT 100`, `cost_budget_usd_per_week`, `rag_namespace TEXT`, `vault_path TEXT`, `pg_schema TEXT NULL`
- `workspace_capability_overrides(company_id, capability_id, mode, override_reason, expires_at)`
- `workspace_lifecycle_events(id, company_id, kind, payload, occurred_at)`
- `workspace_skill_pins(company_id, skill_id, pinned_version, reason)` — pin/un-pin skills per workspace

**Schema (Mission cost attribution):**
- `mission_cost_events(id, company_id, mission_id NULL, agent_id, cost_usd, tokens_in, tokens_out, model, occurred_at)`
- `cost_anomalies(id, company_id, kind, threshold, actual, occurred_at, status)`
- `llm_quota_state(company_id, week_start, tokens_used, cost_used, status)` — per-workspace quota

**Services:**
- `Platform` singleton (TS class) exposing `getAgent(name)`, `getSkill(key, version?)`, `getTool(key)`, `wfqSchedule()`
- `AgentPool` — checks out an agent for a mission, tracks cost
- `SkillLibrary` — semver lookup with canary routing (e.g. 5% traffic to canary)
- `ToolRegistry` — wraps MCP tools with schema validation
- `WfqScheduler` — weighted-fair-queue across workspaces (cron, every 30s)
- `CostAttributor` — listener on every LLM call → writes `mission_cost_events`
- `Company` class refactor — split into `Platform` + per-workspace `WorkspaceContext`

**API:**
- `GET /platform/agents`, `/platform/skills`, `/platform/tools`, `/platform/capabilities`
- `GET /workspaces` (list — alias to companies)
- `GET /workspaces/:id/quota`
- `POST /workspaces/:id/capability-override`
- `GET /workspaces/:id/cost?window=7d`

**UI:**
- Platform Console (admin): catalog of agents/skills/tools/capabilities
- Per-workspace dashboard: cost burn, quota, capability overrides
- Skill version manager (canary % slider)

**Tests:**
- Unit: WFQ scheduling fairness across N workspaces
- Integration: skill canary routing splits traffic correctly
- Property-based: cost attributor never double-counts

**Gate:** 3 fake workspaces with different `wfq_weight` schedule fairly; cost attributed correctly per workspace; skill canary 5% split observable.

---

## Phase 3 — Autonomy Dial + Approval Pattern Extension (3 weeks) [was Phase 1, expanded]

**Goal:** "Human = gate" baseline. Now built **on top of** Platform layer.

**Schema (per ADR-0009):**
- Extend `approvals`: `proposal_pattern` ENUM(confirm|choose|edit|decide), `confidence` NUMERIC, `risk_score` INT, `risk_level` TEXT, `priority` INT, `timeout_hours` INT NULL, `timeout_action` TEXT NULL, `can_delegate` BOOLEAN, `delegated_to_user_id` UUID NULL, `time_to_decision_seconds` INT, `metadata` JSONB (drag-in self-report etc.)
- Extend `companies`: `weekly_gate_quota INT`, `weekly_drag_in_minutes NUMERIC`, `cost_forecast_p50_usd NUMERIC`, `cost_forecast_p90_usd NUMERIC`, `last_autonomy_change_at TIMESTAMPTZ`
- New: `trust_counters(company_id, capability_id, consecutive_success, last_promotion_at, last_demotion_at, mode)` — capabilities from Phase 2 `capability_registry`
- New: `human_drag_in_events(id, company_id, source, occurred_at, self_reported BOOLEAN, payload)`
- New: `quota_preemption_events`
- New: `autonomy_profile_history`

**Services:**
- `AutonomyEngine` — given (workspace, capability, confidence) → routing decision (auto/gate/escalate)
- `TrustCounter` — promotes/demotes capability mode based on success streak
- `NotificationBatcher` — coalesces low-priority approvals into digest (cron 30 min)
- `GateQuotaEnforcer` — preempts when weekly quota burnt

**API:**
- `GET/PATCH /workspaces/:id/autonomy`
- `GET /workspaces/:id/trust-counters`
- `POST /workspaces/:id/dragin` — manual drag-in marker
- `GET /approvals?surface=...&pattern=...` — list with filters
- Extend `POST /approvals/:id/approve|reject` — record `time_to_decision_seconds`, optional `dragIn` self-report

**UI:**
- Approval Center redesign: 4 columns (Confirm / Choose / Edit / Decide) + Critical lane
- Per-pattern rendering (Confirm = single button; Choose = radio; Edit = form; Decide = free-form + Explain)
- Risk-score badge + confidence bar on each card
- Drag-in toggle on response card (self-report per ADR-0008)
- Settings: autonomy slider + 4 templates (sandbox/startup/default/regulated)

**Tests:**
- Unit: trust counter promotion/demotion math
- Integration: gate routing per (autonomy, capability mode, confidence)
- E2E: approve Confirm → counter increments → after 3 successes, capability auto-promotes

**Gate:** Demo workspace with `autonomy_level=medium`, capability "deploy_dev" auto-promotes from gate→auto after 3 successes; drag-in self-report shows on dashboard.

---

## Phase 4 — Strategic Loop Foundation (3-4 weeks) [was Phase 2]

**Goal:** Weekly autonomous PM cycle. Now uses Phase 1 MCP for signals.

**Schema:**
- `strategic_loop_runs` (per ADR-0003)
- `strategic_loop_events` (per ADR-0003)
- `signals(id, company_id, source ENUM, content, raw_metadata, embedding_id NULL, ingested_at, processed_at)` — sources: `human_intake`, `gitlab`, `opensearch`, `research`, `internal`
- `internal_auditor_runs(id, company_id, loop_run_id, score, breakdown_json, occurred_at)`
- `outcome_tracker(id, company_id, prediction_id, predicted_at, t_plus_n_days, predicted, actual, error)`
- `efficiency_reviews(id, company_id, week_start, cost_per_outcome, suggested_actions_json)`

**Services:**
- `StrategicLoopRuntime` — TS state machine per ADR-0003
- Steps: collectSignals → analyzeSignals → researchMarket → planSprint → humanApprovalNode → executePlan → audit → outcomeTrackInline
- `SignalCollector` — pulls from Phase 1 MCP adapters
- `BrainAccessor` — reads/writes `documents(key='brain')` after Phase 0 migration
- `InternalAuditor` — Opus-backed LLM-as-Judge scoring
- `EfficiencyReviewer` — weekly cost/quality analysis
- `OutcomeTracker` — T+7 cron compares prediction vs actual

**API:**
- `POST /workspaces/:id/signals`
- `GET /workspaces/:id/signals?status=...`
- `POST /workspaces/:id/strategic-loop/trigger`
- `GET /workspaces/:id/strategic-loop/runs/:run_id`
- `GET /workspaces/:id/brain`
- `PATCH /workspaces/:id/brain` (revision)

**UI:**
- Project Brain editor (extend existing document editor)
- Signal feed (last 7 days, grouped by source)
- Sprint plan approval card (Confirm pattern + cost preview)
- Weekly efficiency review card (Choose pattern: which suggested action to take)

**Tests:**
- Unit: state machine transitions
- Integration: full Loop with mocked MCP signals → produces approval
- Replay test: re-fold events from `strategic_loop_events` → identical end state
- E2E: human approves sprint plan → issues created

**Gate:** Weekly Loop runs autonomously every Monday on a real workspace, produces approval card, Confirm time < 1 min in 80% of cases.

---

## Phase 5 — Human Intake Hub (3 weeks) [was Phase 3]

**Goal:** All human input flows through one hub.

**Schema:** 7 tables per [[Human-Intake-and-Solution-Loop-Design]] §11 — `intakes`, `intake_responses`, `intake_timelines`, `intake_dependencies`, `intake_clusters`, `intake_promotions`, `feedback_events`.

**Services:**
- `IntakeTriageAgent` — classify (8 types) + dedup using embeddings (Phase 1) + DBSCAN deferred to Phase 10
- 8 per-type workflow runners (problem/feature_request/bug_report/feedback_general/feedback_release/feedback_feature/strategic_input/question)
- `TimelineEstimatorL1` — class-based brackets
- `TimelineEstimatorL2` — Monte Carlo on similar past intakes (deferred to Phase 11 when KB ready)

**API + UI + Integration:** per Human-Intake §3, §10.

**Tests:** per type — unit + integration + E2E.

**Gate (Mile-A milestone):** Submit "feature_request" → triage → 3 candidates → Choose → mission spawned → ETA shown → completion tracked. **All 6 end-to-end flows from [[Full-System-Workflow-and-Coordination]] tested manually.**

---

## Phase 6 — Self-Healing Extension (2 weeks) [was Phase 4 — corrected per review B6]

**Goal:** Live heartbeats + 7 stuck rules + kill switch.

**Schema (corrected):**
- New: `liveness_heartbeats(id, mission_id, agent_id, state, progress_marker, cost_so_far_usd, current_tool, waiting_on, sent_at)` — **the live signal table** (NOT `heartbeat_runs` which is run-log)
- Reuse existing `heartbeat_run_watchdog_decisions` for decisions log
- Extend `human_drag_in_events` with intake-volume kind
- New: `health_scores(company_id, score, computed_at)`
- New: `kill_switch_events(id, company_id, level, triggered_by, reason, cascaded_to, occurred_at)`

**Services:**
- `LivenessAgent` — every running mission emits heartbeat every 10-30s
- `Watchdog` — 7 rules: stalled / infinite-loop / deadlock / cost-runaway / mcp-cascade / state-corruption / drag-in
- `HealthScorer` — composite per workspace
- `KillSwitch` — 5 levels (cancel-task / cancel-cascade / freeze-workspace / kill-agent / full-stop)

**API:**
- `POST /workspaces/:id/kill?level=...`
- `GET /workspaces/:id/health-score`
- `GET /workspaces/:id/stuck-events`
- `POST /missions/:id/heartbeat` (internal SDK)

**UI:**
- Health score widget on Command Center
- Kill confirmation modal (Decide pattern + double-confirm for level≥3)
- Stuck event list (admin)

**Tests:** unit per rule + integration kill+resume + chaos test (kill mid-flow).

**Gate:** Inject stalled mission (no heartbeat 5 min) → watchdog detects → emits stuck event → recovery attempt OR human approval.

---

## Phase 7 — Development Flow + Feature Flags (3-4 weeks) **[NEW]**

**Goal:** How code goes from design → production safely.

**Schema:**
- `design_docs(id, company_id, project_id, key, title, body, status proposed|review|approved|in_dev|live|archived, conflicts_with[] FK, created_at, updated_at)`
- `design_doc_revisions` — version history
- `component_locks(id, project_id, component_path, locked_by_design_doc_id, expires_at)`
- `conflict_events(id, kind schema|api|ui|behavior, design_doc_a, design_doc_b, detected_at, resolved_at NULL)`
- `feature_flags(id, key, description, status off|canary|on, rollout_percent, owner_user_id)`
- `feature_flag_workspace_overrides(flag_id, company_id, value)`
- `canary_runs(id, feature_flag_id, started_at, percent_history_json, status)`

**Services:**
- `DesignDocLifecycle` — state machine per Dev-Flow design
- `ConflictDetector` — 4 conflict types (schema collision, API breaking, UI overlap, behavior contradiction)
- `FeatureFlagEvaluator` — context-aware (workspace, user, % rollout)
- `CanaryController` — 0→5→25→50→100% staged rollout

**API + UI:** Design Docs board, Feature Flag admin, Canary monitor.

**Tests:** state machine + conflict scenarios + flag evaluator.

**Gate:** Two design docs touching same component → conflict detected → resolution required before merge. Feature flag rolls out 5%→100% across 4 stages.

---

## Phase 8 — Greenfield Bootstrap (3 weeks) [was Phase 5]

**Goal:** Idea → Project pipeline (7 stages, 4 gates). Now uses GitLab MCP from Phase 1.

**Schema:**
- `greenfield_intakes`, `greenfield_stages`, `intake_recovery_actions`
- Personas as `documents(key='persona/<slug>')`

**Services:**
- 7-stage orchestrator: Idea → Market Research (MCP research) → Personas → Stack → Brain → Repo Scaffold (GitLab MCP) → Sprint 1
- Per-stage failure recovery state machine

**API + UI + Tests:** per [[Greenfield-Bootstrap-Design]].

**Gate (MVP GATE — major milestone):** Submit "gym tracker app" idea → ~$3.80 cost, ≤1 hour wall-clock → scaffolded GitLab repo + Sprint 1 ready in target workspace.

---

# === MVP GATE === (cumulative ~24-30 weeks = 6-7.5 months)

**MVP Acceptance Criteria:**
- ✅ 1-5 concurrent projects sustainable in <5h/week human time
- ✅ Strategic Loop runs weekly without human kick
- ✅ ≥80% gates use Confirm/Choose pattern (avg < 1 min)
- ✅ Greenfield: 1 fully-bootstrapped project from idea to Sprint 1
- ✅ Self-Healing detects ≥80% stuck events without human
- ✅ Trust counter promoted ≥1 capability per active workspace
- ✅ Cost attribution correct per workspace
- ✅ All 6 end-to-end flows from [[Full-System-Workflow-and-Coordination]] pass

**Decision point:** continue to full system OR pause and operate MVP. If business goal achieved with MVP, defer Phases 9-15.

---

## Phase 9 — Decision Boundary + Brier Calibration (2 weeks) [was Phase 6]

**Schema:** `decision_class_lookup`, `decision_log`, `agent_uncertainty_events`, `brier_calibration`.

**Services:** confidence emission helper, Brier nightly cron, AUTONOMY_THRESHOLD_FACTOR per autonomy level, block trust promotion when Brier > 0.15.

**Gate:** Agent makes 100 decisions → Brier calibrates → trust promotion blocked when degraded.

---

## Phase 10 — Rejection Learning + DBSCAN (2 weeks) [was Phase 7]

**Schema:** `rejection_events` (16-cat ENUM), `rejection_clusters`, `rejection_taxonomy`. Reuse `entity_embeddings` from Phase 1.

**Services:** DBSCAN per ADR-0005 (eps=0.25, minPoints=3), auto-action per cluster size, "we keep failing here" meta-rejection.

**Backfill:** wire intake feedback (Phase 5) DBSCAN clustering — closes deferred scope from Phase 5.

**Gate:** 10 rejected approvals over 7d → cluster forms → auto-promote to `strategic_input` intake.

---

## Phase 11 — Knowledge Base + Magika (3-4 weeks) [was Phase 8 — expanded per review]

**Schema:** `kb_repositories`, `kb_documents`, `kb_chunks`, `kb_coverage_gaps`, `kb_doc_staleness`, `magika_inventory`, `code_symbols` (tree-sitter AST).

**Services:**
- Magika sidecar plugin per ADR-0004 — covers all 5 integration points (brownfield triage, security scan, PR gate supply-chain, greenfield attachment, RAG splitter routing)
- Tree-sitter integration (per language) for AST-aware chunking
- LlamaIndex code splitter wrapper
- Optic / TypeSpec extractor for API spec
- KB cold-start bootstrap (5 stages)
- PR-driven continuous KB update
- Doc staleness scorer (nightly)
- Coverage audit (weekly Sun)
- **L2 timeline estimator backfill (uses KB historical similar intakes)**

**Gate:** New repo onboarded → KB indexed → coverage gaps reported → Magika triage produces inventory → security scan flags supply-chain anomaly → PR gate blocks risky import.

---

## Phase 12 — Cross-Repo Coordination (3 weeks) [was Phase 9]

**Schema:** `sagas`, `saga_steps`, `contract_versions`, `vector_clocks`.

**Services:** saga orchestrator (compensation), contract registry + deprecation, vector-clock staleness audit (every 2h), Brier per-repo.

**Gate:** Multi-repo feature deploys atomically; failure rolls back all repos.

---

## Phase 13 — Release Train + Git-Branch-Tag (3 weeks) [was Phase 10]

**Schema:** extend `releases` with `feature_key` + `train_id`; new `feature_keys`, `train_bindings`, `env_pointers`; extend `issues` with `feature_key`.

**Services:** Release Train builder (cron 30 min), env pointer mover (dev→stag→live), hotfix worktree + forward-port runner, commit conventions enforcer (PR Gate).

**Gate (Mile-B milestone):** Feature_key="auth-redesign" spans 3 repos → train mints → promote to stag → 24h soak → live. **Cross-flow integration test: Strategic Loop produces sprint → Issues with feature_key → PR with conventions → train bundles → canary 5%→100% → outcome tracker compares prediction vs reality.**

---

## Phase 14a — Testing: Foundation (2-3 weeks) [was part of Phase 11]

**Dimensions covered:** visual regression (Playwright screenshots + baseline storage + S3 diff blobs), a11y (axe-core injection), cross-browser (Playwright matrix Chrome/Firefox/WebKit).

**Schema:** `test_runs`, `visual_baselines`, `a11y_violations`.

**Gate:** PR triggers all 3 dimensions; weak score blocks merge.

---

## Phase 14b — Testing: Advanced (3 weeks)

**Dimensions covered:** mobile native (Appium + simulator farm), cross-device (viewport matrix + BrowserStack), i18n (locale matrix + pseudo-locale stress), UX heuristic (LLM-as-Judge with screenshot + DOM).

**Schema:** `mobile_test_runs`, `i18n_violations`, `ux_judge_scores`.

**Note:** Appium + BrowserStack require accounts + adapter setup — budget includes that.

**Gate:** Same as 14a but for these 4 dimensions.

---

## Phase 14c — Testing: Operational (2 weeks)

**Dimensions covered:** property-based fuzz, persona-driven scenarios (Hercules-style NL E2E), production synthetic probes (5 min cron on prod), manual TC fallback (mobile UX for tester) + Test Case Browser UI.

**Schema:** `manual_test_cases`, `persona_scenarios`, `synthetic_probe_results`.

**Gate:** All 16 dimensions report scores per PR; weak dims block train (integrates with Phase 13 Release Train).

---

## Phase 15 — UX Polish + Mobile + Hardening + Release (3 weeks) [was Phase 12]

**Tasks:**
- Mobile UX (React Native iOS + Android — quick capture, approval swipe, manual TC submission)
- "Explain" auditability pattern (every action surface "why" via decision_log)
- Empty states + onboarding flows
- Cross-workspace activity panel
- **Observability for Custom Paperclip itself** (structured logging, health endpoints, metric emission, ops dashboard)
- **Migration scripts** (existing paperclip companies → custom-paperclip schema additions)
- **RBAC final pass** (all 30+ new endpoints)
- **Secrets rotation runbook**
- Doc sync final pass — every obsidian doc reflects shipped behavior
- Release notes + changelog

**Note:** React Native is a 3-4 week sub-budget within this phase. If too tight, mobile becomes a v1.1 deliverable.

**Gate (FULL-SYSTEM GATE):** All cumulative criteria below.

---

# === FULL-SYSTEM GATE === (cumulative ~47-60 weeks = 11-15 months)

**Acceptance:**
1. ✅ 30 concurrent projects sustainable in 12.5h/week human time
2. ✅ ≥80% gates use Confirm/Choose pattern (avg < 1 min)
3. ✅ Trust counter auto-promotes ≥1 capability/week per active workspace
4. ✅ Drag-in events ≤ 1/week per workspace (target)
5. ✅ Strategic Loop runs autonomously every Mon
6. ✅ Greenfield Bootstrap end-to-end < 1h cost ≤ $5
7. ✅ Self-Healing detects + recovers ≥80% stuck events without human
8. ✅ Brier calibrated < 0.15 across all capabilities
9. ✅ Rejection clusters auto-adjust prompts within 14 days
10. ✅ Cross-repo features deploy atomically; rollback works under failure
11. ✅ 16-dim test matrix passes per train; weak dims block release
12. ✅ Mobile approval flow works on iOS + Android
13. ✅ All 6 end-to-end flows from [[Full-System-Workflow-and-Coordination]] pass autonomously
14. ✅ Observability dashboards green; on-call runbook validated by injected incident
15. ✅ Score ≥9/10 per peer architecture review

---

## Integration Milestones

| Milestone | After Phase | Test |
|---|---|---|
| **Mile-A** | 5 (Intake) | All 6 E2E flows manual pass |
| **MVP Gate** | 8 (Greenfield) | 1-5 projects E2E in <5h/wk |
| **Mile-B** | 13 (Release Train) | Feature_key cross-flow E2E |
| **Full-System Gate** | 15 (UX/Hardening) | 15 acceptance criteria above |

---

## Hidden costs accounted for in v2 (vs v1 which missed these)

| Item | Old plan | v2 plan |
|---|---|---|
| Platform/Workspace/Mission layer | Missing | Phase 2 (4-6 wks) |
| External Integrations / MCP | Missing | Phase 1 (2-3 wks) |
| Development Flow + Feature Flags | Missing | Phase 7 (3-4 wks) |
| Embeddings infra | Glossed | Inside Phase 1 |
| Mobile UX (RN) | "polish" | Sub-budget in Phase 15 |
| Agent prompt versioning | Missing | Inside Phase 2 (`skill_versions`) |
| Observability for Custom Paperclip | Missing | Inside Phase 15 |
| Migration scripts | One bullet | Inside Phase 15 |
| RBAC for new endpoints | Missing | Inside Phase 15 final pass |
| Secrets management for MCP | Missing | Inside Phase 1 (reuse `company_secrets`) |
| `documents.key` migration | Missing | Phase 0 corrective |
| `liveness_heartbeats` net-new table | Missing | Phase 6 (corrected) |
| `approvals` vs `approval_items` | Ambiguous | ADR-0009 + Phase 0 |
| Master Overview LangGraph drift | Missing | Phase 0 corrective |
| Testing 5-10x under-scoped | 3 wks | 14a + 14b + 14c (7-9 wks) |

---

## Working agreements (unchanged from v1, plus 2 additions)

1. Every phase delivers; no Phase N+1 work until Phase N gate passes.
2. Doc sync per phase — update obsidian docs with decisions/gaps.
3. ADR for non-trivial choices.
4. Tests-first for schema + state machines.
5. Trust paperclip's existing primitives — extend, don't rewrite.
6. Gates are hard.
7. **NEW: Feature flag everything net-new** — turns on per-workspace; default off.
8. **NEW: Each phase emits structured logs + metrics for itself** — Phase 15 just polishes; observability is built-in from Phase 1.

---

## Risk register v2

| Risk | Mitigation |
|---|---|
| Underestimate MCP adapter complexity (GitLab tools) | Phase 1 strict scope: 10 GitLab tools max; defer rest to Phase 12+ |
| Platform refactor breaks existing paperclip features | Phase 2 ships behind feature flag; existing companies unaffected unless flag on |
| Feature flag Phase 7 before MVP gate causes thrash | Each phase owns its flags; Phase 7 just standardizes the framework |
| Brier calibration drift | Phase 9 nightly cron + drift detection |
| DBSCAN performance at scale | Phase 10 daily cron, capped cluster size, pre-filter via pgvector HNSW |
| Magika Python sidecar reliability | Phase 11 falls back to file-extension heuristics |
| Testing 14a/b/c balloon further | After Phase 11, re-evaluate; can defer 14c if MVP+core enough |
| Mobile RN slips Phase 15 | Mobile is internally flagged: if budget over, ship as v1.1 |
| User burnout at month 6-8 | MVP Gate is a real off-ramp; can operate MVP and pause |

---

## Liên kết

- [[Codebase-to-Design-Mapping]] — design → existing primitives + §7 mismapping fixes
- [[ADR-0003-Strategic-Loop-Runtime]]
- [[ADR-0004-Magika-Sidecar]]
- [[ADR-0005-DBSCAN-Library]]
- [[ADR-0006-Workspace-Equals-Company]]
- [[ADR-0007-Brain-Storage]]
- [[ADR-0008-Drag-In-Detection]]
- [[ADR-0009-Approvals-Architecture]]
- [[Paperclip-Platform-Workspace-Mission-Model]]
- [[Autonomy-Dial-and-Progressive-Trust-Design]]
- [[Autonomous-PM-Strategic-Loop-Design]]
- [[Human-Intake-and-Solution-Loop-Design]]
- [[Self-Healing-and-Liveness-Design]]
- [[Greenfield-Bootstrap-Design]]
- [[Decision-Boundary-and-Uncertainty-Model]]
- [[Cross-Repo-Coordination-and-Decision-Hardening]]
- [[Rejection-Learning-and-Feedback-Loop]]
- [[Knowledge-Base-Management-Strategy]]
- [[Magika-Integration-and-Codebase-Triage]]
- [[Git-Branch-Tag-Release-Train-Strategy]]
- [[Testing-and-Quality-Assessment-Capability]]
- [[UX-Strategy-and-Design]]
- [[External-Integrations-and-Environment-Strategy]]
- [[Development-Flow-and-Release-Strategy]]
- [[Autonomous-Operations-and-Human-Gate-Design]]
- [[Full-System-Workflow-and-Coordination]]
- [[_index]]
