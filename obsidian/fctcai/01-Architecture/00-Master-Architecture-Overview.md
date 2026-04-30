---
tags: [architecture, overview, master, index]
date: 2026-04-29
priority: P0
---

# Master Architecture Overview — Paperclip Autonomous System

> **Mục đích:** Một tài liệu duy nhất gắn 11 design docs lại thành một hệ thống mạch lạc. Đọc tài liệu này TRƯỚC bất kỳ doc nào khác.
> **Mục tiêu hệ thống:** Human chỉ là gate approver. Mọi việc khác — tư duy chiến lược, viết code, deploy, vận hành, học từ thất bại — đều tự động.

---

## 1. Toàn cảnh — Một hình duy nhất

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                          HUMAN (≤ 30-40 phút/tuần)                                │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │  UNIFIED APPROVAL CENTER  +  Command Center  +  Project views  (UX layer)  │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
└──────────┬─────────────────────┬─────────────────────────┬───────────────────────┘
           │ approve/reject       │ kill/resume              │ explain/audit
           ▼                      ▼                          ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                      L5 — INTERACTION LAYER (UX)                                  │
│  Approval Center · Command Center · Mobile · Notifications · Explain pattern     │
└──────────────────────────────────────┬───────────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼───────────────────────────────────────────┐
│                      L4 — STRATEGIC LAYER                                         │
│   Strategic Loop  ◄── Greenfield Bootstrap (cold start from idea)                │
│   Internal Auditor  ──► drift detection                                          │
│   Efficiency Reviewer  ──► improvement actions                                   │
│   Decision Boundary + Uncertainty Model  ──► ask vs decide                       │
│   Rejection Learning  ◄── adjusts prompts/principles/velocity                    │
└──────────────────────────────────────┬───────────────────────────────────────────┘
                                       │ tasks · plans · principles
┌──────────────────────────────────────▼───────────────────────────────────────────┐
│                      L3 — DELIVERY LAYER                                          │
│   Design Lifecycle · Conflict Detection · Branch Strategy                        │
│   PR Gates · Feature Flags · Selective Release · Canary                          │
│   Agent Capability Registry · DB Migration Safety                                │
└──────────────────────────────────────┬───────────────────────────────────────────┘
                                       │ commits · MRs · pipelines
┌──────────────────────────────────────▼───────────────────────────────────────────┐
│                      L2 — OPERATIONS LAYER                                        │
│   CI/CD Pipeline · Monitoring → Incident · Security Scanning                     │
│   Self-Healing (Heartbeat, Watchdog, Stuck Detection, Kill Switch)               │
│   Environment Lifecycle (local/ephemeral/preview/dev/stag/live)                  │
└──────────────────────────────────────┬───────────────────────────────────────────┘
                                       │ MCP tool calls
┌──────────────────────────────────────▼───────────────────────────────────────────┐
│                      L1 — KNOWLEDGE & EXTERNAL LAYER                              │
│   ┌──────────────────────────┐    ┌────────────────────────────┐                │
│   │  KNOWLEDGE BASE          │    │  EXTERNAL MCP              │                │
│   │  · Project Brain         │    │  · GitLab MCP (write)      │                │
│   │  · product_signals       │    │  · OpenSearch MCP (read)   │                │
│   │  · 18 doc types          │    │  · Runner MCP (compose)    │                │
│   │  · API specs (Optic)     │    │  · Tavily / arXiv          │                │
│   │  · pgvector RAG          │    └────────────────────────────┘                │
│   │  · Magika Triage ──┐     │                                                  │
│   └────────────────────┼─────┘                                                  │
│                        │                                                         │
│                        └─► tree-sitter only on real source code                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 11 Documents — Thứ tự đọc

### Đọc theo concept flow (recommended for new joiner)

| Order | Document | Thời gian đọc | Mục đích |
|-------|----------|---------------|----------|
| 1 | `00-Master-Architecture-Overview` (this) | 15 min | Big picture |
| 2 | `Autonomous-PM-Strategic-Loop-Design` | 60 min | Trí tuệ trung tâm |
| 3 | `Knowledge-Base-Management-Strategy` | 30 min | Bộ nhớ tri thức |
| 4 | `Magika-Integration-and-Codebase-Triage` | 20 min | Triage cho brownfield |
| 5 | `Greenfield-Bootstrap-Design` | 25 min | Khởi tạo dự án mới |
| 6 | `Development-Flow-and-Release-Strategy` | 35 min | Cách giao hàng |
| 7 | `Autonomous-Operations-and-Human-Gate-Design` | 40 min | Vận hành tự động |
| 8 | `External-Integrations-and-Environment-Strategy` | 35 min | MCP + môi trường |
| 9 | `Self-Healing-and-Liveness-Design` | 20 min | Tự chữa khi stuck |
| 10 | `Decision-Boundary-and-Uncertainty-Model` | 25 min | Khi nào hỏi human |
| 11 | `Rejection-Learning-and-Feedback-Loop` | 20 min | Học từ reject |
| 12 | `UX-Strategy-and-Design` | 40 min | Mặt nạ với human |

**Total:** ~6 giờ đọc. Sau đó mỗi doc là tham chiếu chuyên đề.

### Đọc theo persona

| Persona | Docs ưu tiên |
|---------|-------------|
| Developer mới | 1, 2, 3, 6, 9 |
| Operator (human gate) | 1, 7, 12 |
| Auditor / PM | 1, 2 (đặc biệt §9, §17), 11, 12 |
| Solution architect | Toàn bộ, theo thứ tự |
| Security / SRE | 1, 2 (§12), 4, 7, 8, 9 |

---

## 3. Phân lớp kiến trúc — 5 layers

### L1 — Knowledge & External Layer
**Trách nhiệm:** Cung cấp tri thức (project + tech docs + signals) + giao diện ra thế giới ngoài.

**Components:**
- **Project Brain** — bộ nhớ dài hạn, source of truth cho mục tiêu/principle/decisions/metrics/velocity
- **product_signals** — feedback từ customer/market đổ vào
- **Knowledge Base** — 18 doc types có tier, multi-repo, RAG-indexed
- **Magika Triage** — pre-filter trước khi tree-sitter parse
- **External MCP** — GitLab (write), OpenSearch (read), Runner (compose), Tavily/arXiv (research)

**Docs phụ trách:** KB Management, Magika, External Integrations §1-§5

### L2 — Operations Layer
**Trách nhiệm:** Giữ system chạy, deploy, phát hiện sự cố, tự chữa.

**Components:**
- CI/CD Pipeline (GitLab-native via MCP)
- Monitoring → Incident (log-driven via OpenSearch)
- Security Scanning (3-layer + Magika disguise detection)
- Liveness/Heartbeat + Watchdog
- Kill Switch (5 levels)
- 6-tier environment lifecycle (local-developer / ephemeral / preview / dev / stag / live)

**Docs phụ trách:** Auto Ops §3-§6, External Integrations §6-§8, Self-Healing

### L3 — Delivery Layer
**Trách nhiệm:** Biến quyết định chiến lược thành code, MR, release.

**Components:**
- Design lifecycle (draft→reviewed→approved→implemented)
- Conflict Detection Engine (4 conflict types)
- Branch Strategy (`feature/ATO-{id}-{slug}`, etc.)
- PR Gates (tests + Optic API + Magika scan)
- Feature Flags + Selective Release
- Canary 5%→25%→50%→100%
- Agent Capability Registry (skill-based routing)
- DB Migration Safety

**Docs phụ trách:** Development Flow, Auto Ops §6-§7

### L4 — Strategic Layer
**Trách nhiệm:** Tư duy ở tầm sản phẩm — quyết định build cái gì, đánh giá hiệu quả, học.

**Components:**
- **Strategic Loop** (TS state machine — see [[ADR-0003-Strategic-Loop-Runtime]]): collect_signals → analyze_signals → plan_sprint → interrupt(human) → execute
- **Internal Auditor**: LLM-as-Judge đánh giá Loop quyết định đúng/sai
- **Efficiency Reviewer**: per-task cost/quality + improvement actions
- **Greenfield Bootstrap**: idea → project_brain (7 stages)
- **Decision Boundary + Uncertainty Model**: ask vs decide
- **Rejection Learning**: học từ reject để không lặp lại
- **Budget Governance + Emergency Circuit Breaker**

**Docs phụ trách:** Strategic Loop, Greenfield, Decision-Boundary, Rejection-Learning

### L5 — Interaction Layer
**Trách nhiệm:** Giao diện với human — silence is healthy, mỗi interruption phải đáng giá.

**Components:**
- Approval Center (15 gate types unified)
- Command Center (system health glance)
- Mobile UX (swipe approve/defer)
- 4-level notification hierarchy
- "Explain" auditability pattern
- 5 critical user flows

**Docs phụ trách:** UX Strategy, Auto Ops §2 (Approval Center), Auto Ops §9 (Notifications)

---

## 4. Cross-Layer Data Flow — End-to-End Scenarios

### Scenario A: Brownfield project onboard (the hardest case)

```
HUMAN: "Take over this 10-year-old GitLab repo, 5M files, no docs"
   │
   ▼
L1 ─ Magika scans entire repo (~12 min) → file_inventory + triage_report
     · 70% vendored → skip
     · 10% build artifacts → skip
     · 6% generated → skip
     · 14% real source/config/docs → keep
   │
   ▼
L5 ─ Approval Center: "Triage Report ready, review hot zones?"
HUMAN: ✅ approve hot zones, override 1 cold zone
   │
   ▼
L1 ─ KB Cold Start (KB §3) runs tree-sitter only on the 14% kept
     · Generates: data flow, sequence, integration, API specs, ADRs
     · pgvector RAG indexed
   │
   ▼
L4 ─ Strategic Loop: collect_signals from existing tickets/reviews
     analyze_signals → propose Sprint 1
   │
   ▼
L5 ─ Approval Center: Sprint 1 plan
HUMAN: ✅ approve
   │
   ▼
L3 ─ Engineering agents create branches, commits, MRs
L2 ─ CI/CD runs, security scan, ephemeral preview created
   │
   ▼
L5 ─ Approval Center: PR #1 ready (high-risk auto-flag)
HUMAN: ✅ approve
   │
   ▼
L2 ─ Merge → dev → stag → human approve → live with canary
   │
   ▼
L4 ─ Internal Auditor T+7 days: was decision sound? scores agents
L4 ─ Efficiency Review: per-task cost/quality
```

### Scenario B: Customer signal triggers strategic decision

```
L1 ─ product_signals receives 50 churn-related tickets in 7 days
   │
   ▼
L4 ─ Strategic Loop runs (weekly cron)
     · collect_signals: 50 churn signals + competitor release detected
     · analyze_signals: identifies retention crisis
     · plan_sprint: proposes "Stop churn" sprint with 5 tasks
     · uncertainty: 0.35 → exceeds threshold for sprint plan (0.4? no, ≤)
     → auto-routed to human gate
   │
   ▼
L5 ─ Approval Center: Sprint plan + reasoning + signals evidence
HUMAN: ❌ reject — "wrong_priority + risk_too_high"
   │
   ▼
L4 ─ Rejection Learning captures structured reason
     · clusters with 2 prior similar rejections in last 30d
     · pattern detected → auto-action: adjust planner prompt to weight
       roadmap epics higher
   │
   ▼
L4 ─ Strategic Loop re-runs with new prompt → new plan
   │
   ▼
L5 ─ HUMAN: ✅ approve revised plan
   │
   ▼
L4 ─ Auditor logs adjustment effectiveness over 30d
```

### Scenario C: System gets stuck, self-heals

```
L4 ─ Engineering agent calls "format_code" tool 12 times in 5min
     with similar args (cosine sim 0.95)
   │
   ▼
L2 ─ Watchdog detects: failure_mode=infinite_loop
     · Captures last 50 tool calls as evidence
     · Kills agent immediately
     · Writes stuck_event
   │
   ▼
L5 ─ Notification: HIGH severity, Approval Center entry
     "Agent X stuck in loop on Task Y. Auto-killed.
      Suggested actions: [Restart] [Disable agent] [Investigate]"
   │
   ▼
HUMAN: 🔍 click Investigate → sees evidence → adjusts agent prompt
   │
   ▼
L4 ─ Rejection Learning: this becomes a known pattern, adjustment tracked
```

### Scenario D: Greenfield project birth

```
HUMAN: "Build a SaaS for fitness tracking, $5k/mo budget, 8 weeks"
   │
   ▼
L4 ─ Greenfield Bootstrap Stage 1: idea → ProductHypothesis
   │
   ▼
L5 ─ Gate 1: human approve hypothesis → ✅
   │
   ▼
L1 ─ Stage 2: Tavily + arXiv + GitHub research → market_brief.md
L4 ─ Stage 3: persona generation
   │
   ▼
L5 ─ Gate 2: approve personas + top 5 stories → ✅
   │
   ▼
L4 ─ Stage 4: stack recommender (queries L1 KB for org's prior stacks)
   │
   ▼
L5 ─ Gate 3: approve stack → ✅
   │
   ▼
L1 ─ Stage 5: project_brain auto-generated
   │
   ▼
L5 ─ Gate 4: approve brain → ✅
   │
   ▼
L1+L2 ─ Stage 6: GitLab MCP scaffold + CI/CD + lint+build verify
   │
   ▼
L4 ─ Stage 7: Strategic Loop produces Sprint 1
   │
   ▼
L5 ─ Gate 5 (standard): approve Sprint 1 → ✅
   │
   ▼
[Now in normal Scenario B flow]
```

---

## 5. Glossary — Thuật ngữ thống nhất

| Term | Định nghĩa duy nhất |
|------|---------------------|
| **Project Brain** | Bộ nhớ dài hạn của 1 project. Schema: goal, phase, principles, decisions, metrics, velocity, risk_register. Tier: Eventually consistent (<1h staleness). Snapshot mode in Strategic Loop runs. |
| **Strategic Loop** | TS state machine (per [[ADR-0003-Strategic-Loop-Runtime]]) chạy weekly cron. Steps: collect_signals → analyze_signals → plan_sprint → interrupt(human gate) → execute. State persisted via Drizzle in `strategic_loop_runs` + `strategic_loop_events`; replay = re-fold events. |
| **Internal Auditor** | LLM-as-Judge (Opus) độc lập đánh giá chất lượng quyết định Loop. Ghi `audit_reports`. |
| **Efficiency Reviewer** | Per-task analysis: cost vs estimate, quality score, root cause taxonomy, improvement_actions với state machine. |
| **Approval Center** | Single queue cho 15 gate types. Risk-scored (0-100), timeout policies, batch approve. |
| **Decision Log** | Single source of truth cho mọi non-trivial agent decision. Reads by: Explain UI, Auditor, consistency cron. |
| **Uncertainty** | Composite 0-1 score: 0.25*self_conf + 0.25*historical + 0.20*completeness + 0.15*similarity + 0.15*source_quality. |
| **Bucket** (file) | Magika triage classification: source_code/config/docs/test/generated/vendored/build_artifact/binary_asset/suspicious/unknown. |
| **MCP Server** | External integration via Model Context Protocol. Types: GitLab (write), OpenSearch (read), Runner (compose), Tavily/arXiv (research). |
| **Environment** | 6-tier: local-developer, ephemeral (per-task docker-compose), preview (per-MR Review App), dev, stag, live. |
| **Heartbeat** | Liveness signal emitted by long-running agents every 30s (5s during tool calls). |
| **Stuck Event** | Detected failure mode: stalled / infinite_loop / deadlock / cost_runaway / mcp_cascade / corruption / zombie. |
| **Kill Switch** | Human override 5 levels: task / workflow / agent / project / global. |
| **Risk Score** | 0-100 per approval. Modifiers: production+20, irreversible+15, security+25, revenue+10. |
| **Rejection Pattern** | DBSCAN cluster of ≥2 similar rejections. Triggers auto-adjustment after threshold. |
| **Triage Report** | Magika output for repo: bucket counts, language histogram, hot zones, cold zones, anomalies. |
| **Brain Snapshot** | Frozen view of project_brain taken at start of Strategic Loop run. Updates staged, applied post-run. |
| **Component Lock** | Soft/hard lock to prevent concurrent modifications to same component (Dev Flow §2). |
| **Feature Flag** | Every new feature gated. Rollout 0→5→25→50→100% with metric gates. |
| **Greenfield Intake** | New project from idea-only. 7 stages, 4 human gates, ~$3.80 cost. |

---

## 6. Core Database Tables — Cross-Doc Map

| Table | Doc | Purpose |
|-------|-----|---------|
| `project_brain` | Strategic Loop §2 | Bộ nhớ dài hạn của project |
| `product_signals` | Strategic Loop §3 | Customer feedback, market signals |
| `audit_reports` | Strategic Loop §9 | Internal auditor outputs |
| `task_outcomes` | Strategic Loop §10 | T+7 outcome tracking |
| `task_efficiency_reviews` | Strategic Loop §17 | Per-task quality/cost analysis |
| `efficiency_improvement_actions` | Strategic Loop §17 | Improvement state machine |
| `project_repos` | KB §5 / Strategic §18 | Multi-repo registry |
| `tech_docs`, `api_specs` | KB §5 / Strategic §18 | Technical documentation |
| `doc_coverage_gaps` | KB §5 | Coverage audit |
| `design_docs` | Dev Flow §2 | Design lifecycle |
| `component_locks` | Dev Flow §2 | Concurrency safety |
| `feature_flags` | Dev Flow §5 | Rollout control |
| `approval_items` | Auto Ops §2 | Unified approval queue |
| `service_metrics`, `alert_rules` | Auto Ops §4 | Monitoring |
| `migration_reviews` | Auto Ops §6 | DB migration safety |
| `agent_capabilities` | Auto Ops §7 | Skill-based routing |
| `mcp_servers` | External §2 | MCP registration |
| `project_environments` | External §3 | 6-tier env lifecycle |
| `ephemeral_workspaces` | External §3 | docker-compose lifecycle |
| `liveness_heartbeats` | Self-Healing §6 | Agent liveness |
| `stuck_events` | Self-Healing §6 | Failure event log |
| `kill_events` | Self-Healing §6 | Human override audit |
| `workflow_health` | Self-Healing §6 | Health score per workflow |
| `paused_workflows` | Self-Healing §6 | Resumable kills |
| `greenfield_intakes` | Greenfield §4 | Project birth tracking |
| `bootstrap_progress` | Greenfield §4 | 7-stage progress |
| `rejection_events` | Rejection-Learning §7 | Structured rejections |
| `rejection_patterns` | Rejection-Learning §7 | DBSCAN clusters |
| `learned_adjustments` | Rejection-Learning §7 | Auto-applied changes |
| `decision_log` | Decision-Boundary §5 | All non-trivial decisions |
| `uncertainty_calibration` | Decision-Boundary §9 | Calibration cron |
| `consistency_violations` | Decision-Boundary §9 | Invariant breaks |
| `brain_snapshots` | Decision-Boundary §9 | Frozen brain views |
| `file_inventory` | Magika §6 | Per-file Magika labels |
| `triage_reports` | Magika §6 | Repo-level triage |
| `magika_cache` | Magika §5 | Hash-based scan cache |
| `cross_repo_releases`, `cross_repo_steps` | Cross-Repo §1.2 | Saga orchestration runtime |
| `automation_mode_config`, `automation_mode_audit` | Cross-Repo §5.2 | Bypass-mode state + audit |
| `agent_predictions`, `adjustment_outcomes` | Cross-Repo §2-3 | Calibration + meta-rejection |
| `backup_runs`, `dr_drills` | DR §3.1 / §5.2 | Backup chain + drill outcomes |
| `release_trains`, `release_train_components` | Git-Branch-Tag §5 | Cross-repo release bundle |
| `feature_repo_links` | Git-Branch-Tag §5 | Feature → MR per repo binding |
| `agent_worktrees` | Git-Branch-Tag §7.3 | Per-agent isolated working dirs |
| `visual_baselines`, `visual_diffs` | Testing §3.4 | Visual regression baselines + per-PR diffs |
| `a11y_violations` | Testing §4.5 | Accessibility audit results (WCAG) |
| `browser_test_runs`, `mobile_test_runs` | Testing §5.3 / §7.5 | Cross-browser + native mobile runs |
| `i18n_keys`, `i18n_coverage` | Testing §8.4 | Localization catalog + coverage |
| `ux_reports` | Testing §9.6 | LLM-as-Judge Nielsen heuristic outcomes |
| `perf_baselines` | Testing §12.1 | Performance regression baselines |
| `synthetic_probes` | Testing §14.4 | Production probe runs + alerts |

**Total:** ~71 core tables (60 prior + 11 added by Testing capability doc). Postgres single source of truth for state, OpenSearch for log telemetry.

---

## 7. Tech Stack — Consolidated

| Layer | Component | Technology |
|-------|-----------|-----------|
| Orchestration | Strategic Loop, agents | **TS state machine** (per [[ADR-0003-Strategic-Loop-Runtime]]) on Node 20 |
| Persistence | Checkpointer, state | **Drizzle ORM + Postgres / PGlite** (`strategic_loop_runs/events`) |
| Tracing | Audit, Explain | `decision_log` + `strategic_loop_events` replay (no LangSmith) |
| Memory tier 3 | RAG | **pgvector + LlamaIndex (TS)** + tree-sitter chunking |
| Code parsing | KB | **tree-sitter** + Magika prefilter |
| API specs | KB | **Optic + TypeSpec** |
| Diagrams | KB | **Mermaid** (LLM-generated) + D2lang |
| Triage | KB cold start | **Google Magika** |
| File IDs | Security | Magika |
| Search/research | Signals | **Tavily**, arXiv API, GitHub API |
| External code | Source of truth | **GitLab** (via MCP) |
| Logs | Telemetry | **OpenSearch** (via MCP, read-only) |
| Workspaces | Ephemeral env | **docker-compose** (via Runner MCP) |
| Production env | dev/stag/live | **Kubernetes** (Paperclip doesn't access directly) |
| API contract diff | Pre-merge | **Optic** |
| Feature flags | Rollout | self-hosted (Postgres-backed) |
| Approvals | Human gate | Postgres + UI |
| Notification | Outbound | Slack, PagerDuty, Email, Push |
| LLM | Reasoning | **Claude Sonnet 4.6** primary, **Opus 4.7** for Auditor |
| Embeddings | RAG | OpenAI text-embedding-3-large (or local equivalent) |
| Frontend | UI | React + TypeScript |
| Mobile | UX | React Native (iOS + Android) |

---

## 8. Implementation Roadmap — Master Timeline

Ưu tiên dựa trên: dependency order + value delivered.

### Sprint 0 — Foundation (1 week) — **superseded by Custom Paperclip [[Implementation-Master-Plan]] v2 Phase 0 + 1**
- [ ] Replaced by Phase 0 corrective items: `documents.key` migration ✅, ADRs 0003-0009 ✅
- [ ] Replaced by Phase 1: MCP server registration (GitLab + OpenSearch + Tavily/arXiv), embedding pipeline
- [ ] Replaced by Phase 2: Platform/Workspace/Mission Layer with workspace isolation
- [ ] Other tables (`product_signals`, `decision_log`, `liveness_heartbeats`) live in their respective phases (4, 9, 6)

### Sprint 1 — Strategic Loop MVP (1 week)
- [ ] collect_signals → analyze_signals → plan_sprint nodes
- [ ] interrupt() to Approval Center
- [ ] Weekly digest
- [ ] Budget guard

### Sprint 2 — Magika + KB Bootstrap (2 weeks)
- [ ] magika-service deployed
- [ ] file_inventory + triage_reports tables
- [ ] KB §3 cold start with Magika prefilter
- [ ] tree-sitter parse on filtered files
- [ ] pgvector RAG index

### Sprint 3 — Approval Center + UX shell (1 week)
- [ ] approval_items + 15 gate types
- [ ] Risk scoring engine
- [ ] Approval Center UI
- [ ] Command Center widget

### Sprint 4 — Self-Healing (1 week)
- [ ] Heartbeat protocol + watchdog
- [ ] Stuck detection rules
- [ ] Kill switch UX
- [ ] workflow_health score

### Sprint 5 — Dev Flow (2 weeks)
- [ ] design_docs lifecycle
- [ ] Conflict Detection Engine
- [ ] Branch strategy + agent capability registry
- [ ] PR Gates (CI + Optic + Magika scan)
- [ ] Feature flags + canary controller

### Sprint 6 — Auditor + Efficiency Reviewer (1.5 weeks)
- [ ] audit_reports schema + Auditor graph
- [ ] task_outcomes T+7 tracker
- [ ] task_efficiency_reviews
- [ ] efficiency_improvement_actions state machine

### Sprint 7 — Decision Boundary + Rejection Learning (1.5 weeks)
- [ ] decision_log full coverage
- [ ] Uncertainty estimation + calibration
- [ ] rejection_events + DBSCAN clustering
- [ ] Auto-adjustment engine

### Sprint 8 — Greenfield Bootstrap (1.5 weeks)
- [ ] Intake wizard
- [ ] 7-stage pipeline
- [ ] Stack recommender + GitLab scaffolding

### Sprint 9 — Auto Ops Polish (1 week)
- [ ] Monitoring → Incident automation
- [ ] Security scanning pipeline (3-layer)
- [ ] DB migration safety net

### Sprint 10 — Mobile + UX Polish (1 week)
- [ ] Mobile approval (swipe gestures)
- [ ] Notification routing all channels
- [ ] Empty states + Explain pattern everywhere

### Sprint 11 — Cross-Repo Coordination & Hardening (2 weeks) — see [[Cross-Repo-Coordination-and-Decision-Hardening]]
- [ ] Saga-style cross-repo release orchestrator
- [ ] Contract evolution + deprecation auto-plan
- [ ] Brier calibration nightly loop
- [ ] Vector-clock staleness budget + adjustment genealogy
- [ ] Automation Mode hardening (graduated trust + hard floors)

**Total:** ~14 weeks for full Paperclip platform.
MVP (single-workspace) usable after Sprint 3 (~5 weeks).
Multi-workspace orchestration production-ready after Sprint 8 (~12 weeks).

---

## 9. Open Questions — Cross-Doc

| # | Question | Owner doc | Status |
|---|----------|-----------|--------|
| 1 | i18n strategy | (gap) | Open — out of MVP scope |
| 2 | API rate limiting per MCP | External Integrations §9 | Partial |
| 3 | Cost amortization at 100+ projects | Strategic Loop §11 | Partial |
| 4 | First-time operator calibration mode | [[Cross-Repo-Coordination-and-Decision-Hardening]] §5.4 (graduated trust) | **Resolved** (2026-04-29) |
| 5 | Magika model version pinning policy | Magika §11 | Resolved (pin per-container) |
| 6 | Cross-repo atomic deploy | [[Cross-Repo-Coordination-and-Decision-Hardening]] §1 | **Resolved** (2026-04-29) |

Item #4 (i18n) is the only remaining gap; lower priority since current target market is single-locale. Items 5-6 partially covered, see referenced docs.

---

## 10. Liên kết — Custom Paperclip docs

### Foundation (3 docs)
- [[Paperclip-Platform-Workspace-Mission-Model]]
- [[Autonomy-Dial-and-Progressive-Trust-Design]]
- [[Full-System-Workflow-and-Coordination]]

### Core (6 docs)
- [[Autonomous-PM-Strategic-Loop-Design]]
- [[Knowledge-Base-Management-Strategy]]
- [[Development-Flow-and-Release-Strategy]]
- [[Autonomous-Operations-and-Human-Gate-Design]]
- [[External-Integrations-and-Environment-Strategy]]
- [[UX-Strategy-and-Design]]

### Autonomy completers (4 docs)
- [[Self-Healing-and-Liveness-Design]]
- [[Greenfield-Bootstrap-Design]]
- [[Rejection-Learning-and-Feedback-Loop]]
- [[Decision-Boundary-and-Uncertainty-Model]]

### Brownfield enabler (1 doc)
- [[Magika-Integration-and-Codebase-Triage]]

### Coordination & Hardening (1 doc)
- [[Cross-Repo-Coordination-and-Decision-Hardening]]

### Git ops (1 doc)
- [[Git-Branch-Tag-Release-Train-Strategy]]

### Testing & Quality (1 doc)
- [[Testing-and-Quality-Assessment-Capability]]

### Index
- [[_index]]

---

## 11. North Star Metric

**Human time + gate count per project per week** = key autonomy KPIs. Đo định lượng theo phases ở [[Autonomy-Dial-and-Progressive-Trust-Design]] §1.1.

| Phase | Active workspaces | Gate / project / week | Auto-resolve % | Human time / project / week | Drag-in / week |
|---|---|---|---|---|---|
| Phase 1 (MVP) | 1-5 | ≤ 8 | ≥ 70% | ≤ 60 min | ≤ 2 |
| Phase 2 (Mid) | 5-15 | ≤ 5 | ≥ 85% | ≤ 40 min | ≤ 1 |
| Phase 3 (Full) | 15-30 | ≤ 3 | ≥ 92% | ≤ 25 min | 0 |

**Drag-in event** = anh bị kéo vào ngoài Approval Center (debug, manual fix, ad-hoc) — đây là metric quan trọng nhất, đo "automation thật vs giả".

Phase 3 hit → 30 dự án × 25 min = **~12.5h/week**, tức Paperclip thực sự là part-time job.

Nếu metric trends up → autonomy đang regress → trigger:
1. Auditor weekly review of capability promotion log.
2. Drag-in events RCA → propose skill / capability / threshold update.
3. Per-workspace autonomy profile recalibration.
4. Escalate to architecture review nếu rooted in design gap.
