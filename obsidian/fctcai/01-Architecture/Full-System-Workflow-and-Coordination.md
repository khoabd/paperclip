---
tags: [architecture, workflow, coordination, runtime, master]
date: 2026-04-29
priority: P0
---

# Full System Workflow & Coordination — Paperclip Runtime

> **Mục đích:** Khác với Master Overview (mô tả CẤU TRÚC tĩnh), tài liệu này mô tả MẠCH CHẠY động — khi nào component nào trigger, dữ liệu chảy giữa chúng ra sao, các vấn đề bị bắt và xử lý như thế nào, và toàn bộ qui trình phối hợp xuyên suốt hệ thống.
>
> **Cách đọc:** §3-§4 (Trigger inventory) là tham chiếu. §5-§9 là 5 flow chính. §10 là interaction matrix. §11 là failure handoff. §12 là cost timing.

---

## 1. 4 Domain Thời Gian

Mọi thứ trong Paperclip chạy theo 1 trong 4 domain thời gian:

| Domain | Latency budget | Driver | Ví dụ |
|--------|---------------|--------|-------|
| **Real-time** | < 30 giây | Event-driven | Heartbeat tick, log alert, kill button |
| **Near-real-time** | < 5 phút | Webhook / queue | PR webhook, customer signal arrival, MCP failure |
| **Periodic** | Cron 1m–1h | Scheduler | Watchdog, alert evaluator, MCP health probe |
| **Strategic** | Cron 1d–1w | Slow loop | Strategic Loop weekly, Auditor T+7, monthly audit |

→ Cùng 1 component có thể có hooks trong nhiều domain. Ví dụ Approval Center: real-time (UI), periodic (timeout sweeper), strategic (weekly digest).

---

## 2. Trigger Inventory — Toàn bộ nguồn kích hoạt

### 2.1 Event-driven triggers (push)

| Event | Source | Receiver | Latency | Ref |
|-------|--------|----------|---------|-----|
| Customer ticket | Support webhook → product_signals | Strategic Loop next cycle | seconds | Strategic §3 |
| App review posted | App Store API | product_signals | minutes | Strategic §3 |
| GitLab MR opened | GitLab webhook | CI/CD orchestrator | seconds | Auto Ops §3, External §4 |
| GitLab pipeline status | GitLab webhook | PR Gate evaluator | seconds | Auto Ops §3 |
| OpenSearch alert fires | Alert evaluator cron OR direct webhook | Incident handler | < 2 min | Auto Ops §4 |
| Heartbeat absent | Watchdog cron tick | Stuck detector | < 5 min | Self-Healing §3 |
| Approval submitted | UI POST | Approval Center → router | seconds | Auto Ops §2 |
| Approval rejected | UI POST | Rejection Learning | seconds | Rejection §3 |
| Kill button clicked | UI POST | Kill executor | seconds | Self-Healing §5 |
| Magika anomaly | Magika service post-scan | Security agent + triage_report | minutes | Magika §4 |
| File pushed to repo | GitLab post-receive webhook | KB continuous update | seconds | KB §4 |
| Migration proposed | Engineering agent | Migration Validator | seconds | Auto Ops §6 |
| Greenfield intake submitted | UI POST | Bootstrap orchestrator | seconds | Greenfield §3 |
| **Human intake created** (in-flight project) | UI / email / mobile / API POST → `intake_items` | Triage agent + Strategic Loop signal collector | seconds | Human-Intake §3 |
| **Human intake state changed** (triaged / candidates_ready / approved / rejected / completed) | Intake state machine | Approval Center + Submitter notification + Outcome tracker | seconds | Human-Intake §10.1 |
| **Feedback cluster promoted** (DBSCAN ≥5/14d → auto-intake) | Feedback aggregator cron | Intake creator (problem or feature_request) | minutes | Human-Intake §9 |
| Cost runaway detected | Heartbeat aggregator | Self-Healing Rule 4 | seconds | Self-Healing §3 |
| MCP timeout cascade | MCP client wrapper | Circuit breaker | seconds | Self-Healing §3 |
| Design conflict found | Conflict Detection Engine | Approval Center | seconds | Dev Flow §3 |
| Canary metric breach | Canary controller | Auto-rollback | < 1 min | Dev Flow §5, Auto Ops §4 |
| Train ready to promote | Release Train builder | Approval Center (env/dev → env/stag → env/live) | seconds | Git-Branch-Tag §5, §11 |
| All Train repos green | PR Gate aggregator | Train state `ready_to_promote` | seconds | Git-Branch-Tag §5 |
| Hotfix incident filed | Incident handler / human | Worktree spawner + maintenance branch | seconds | Git-Branch-Tag §7 |
| Hotfix tag pushed | GitLab webhook | env/live promote (skip dev/stag if hot) | seconds | Git-Branch-Tag §7 |
| Forward-port cherry-pick conflict | Forward-port runner | Approval Center / Engineer agent | seconds | Git-Branch-Tag §7.5 |
| Manual TC submitted | Tester mobile UX → POST report | Test Case orchestrator → validate → feed Train gate | seconds | Testing §17 |
| Visual regression diff > threshold | PR Gate visual job | Approval Center (UX review item) | seconds | Testing §3, §15 |
| a11y violation (serious/critical) | axe-core job | PR Gate block | seconds | Testing §4 |
| Production synthetic probe fail | Hercules cron 5-min | Auto-rollback OR canary pause | < 5 min | Testing §14 |

### 2.2 Cron-driven triggers (pull)

| Cron | Frequency | Purpose | Ref |
|------|-----------|---------|-----|
| Watchdog tick | every 60s | Detect stuck workflows | Self-Healing §2 |
| Alert evaluator | every 60s | Evaluate `alert_rules` over OpenSearch logs | Auto Ops §4 |
| MCP health probe | every 30s when broken, 5m healthy | Circuit breaker recovery | External §2 |
| Approval timeout sweeper | every 5 min | Apply timeout policies | Auto Ops §2 |
| Cost guard scan | every 5 min | Project budget vs spend | Strategic §11 |
| Liveness compactor | every 1h | Roll up heartbeats into workflow_health | Self-Healing §6 |
| Consistency invariant cron | every 30 min | Cross-table integrity checks | Decision-Boundary §6 |
| Uncertainty calibration | nightly 02:00 | Update calibration_offset | Decision-Boundary §3 |
| Rejection clustering | nightly 03:00 | DBSCAN on rejection_events | Rejection §4 |
| Doc staleness scorer | nightly 04:00 | Rank tech_docs by staleness | KB §4 |
| Coverage audit | weekly Sun 02:00 | Compute doc_coverage_gaps | KB §5 |
| Strategic Loop | weekly Mon 08:00 | Full PM cycle | Strategic §4 |
| Internal Auditor | weekly Mon 09:00 (after Loop) | Score Loop's output | Strategic §9 |
| Outcome tracker | daily, lookback T+7 | Compare predictions vs reality | Strategic §10 |
| Efficiency review | daily | Per-completed-task analysis | Strategic §17 |
| Magika cache cleanup | weekly | Drop unreferenced entries | Magika §5 |
| Brain snapshot pruner | daily | Keep last 30 snapshots/project | Decision-Boundary §6 |
| Weekly digest | weekly Fri 17:00 | Summary email/Slack | Strategic §5 |
| Release Train builder | every 30 min | Group ready feature_keys → mint trains/YYYY.MM.Wxx.rN tag | Git-Branch-Tag §5 |
| Env pointer health check | every 15 min | Verify env/dev|stag|live tag still on healthy Train | Git-Branch-Tag §6 |
| Hotfix forward-port runner | every 1h | Auto cherry-pick maintenance hotfixes back to main | Git-Branch-Tag §7.5 |
| Production synthetic probe | every 5 min | Hercules NL E2E persona scenarios on prod | Testing §14 |
| Manual TC SLA monitor | every 1h | Detect overdue manual TC, escalate tester pool | Testing §17 |
| Brier calibration | nightly 02:30 | Update agent uncertainty calibration | Cross-Repo §2 |
| Vector clock staleness audit | every 2h | Flag agents reading stale brain snapshots | Cross-Repo §4 |

### 2.3 Human-driven triggers

| Action | Source | Receiver |
|--------|--------|----------|
| Approve gate | UI button | Workflow resume |
| Reject gate | UI button + dialog | Rejection Learning + Workflow re-plan |
| Kill workflow | UI button | Self-Healing kill executor |
| Resume paused workflow | UI button | Workflow resume from checkpoint |
| New project intake | Wizard submit | Greenfield orchestrator |
| **Human intake submit (in-flight project)** | Console form / mobile / email / API | Triage agent → Strategic Loop signal collector |
| **Intake solution approve / edit / reject** | Approval Center (Confirm/Choose/Edit/Decide pattern) | Mission spawner OR Rejection Learning |
| **Close / cancel intake** | Intake detail page | State machine → checkpoint snapshot + cancel missions |
| Override MCP config | Admin panel | mcp_servers update |
| Disable agent | Admin panel | agent_capabilities update |
| Override triage bucket | Triage report UI | file_inventory update |
| Promote Train env/dev→stag→live | Approval Center "Promote" button | env pointer tag mover |
| Trigger hotfix workflow | Incident UI button | Worktree spawner from `release/x.y` |
| Submit manual TC report | Tester mobile UX | Test Case orchestrator validate |
| Approve manual TC pass/fail | Approval Center (Quality tab) | Train gate signal |
| Run TC now | Test Case Browser button | Hercules / Appium / suite executor |

---

## 3. Master System Wiring Diagram

```
                              ┌──────────────────────────────────┐
                              │             HUMAN                 │
                              │   (Approval Center / Mobile)      │
                              └──────────────────┬────────────────┘
                                                 │
                approve / reject / kill / resume / new intake / override
                                                 │
   ┌─────────────────────────────────────────────▼──────────────────────────────────┐
   │                          UNIFIED APPROVAL CENTER                                │
   │  approval_items │ risk scoring │ timeout sweeper │ batch approve │ explain      │
   └──────┬──────────┬─────────────┬─────────────┬─────────────────┬─────────────────┘
          │ approve  │ reject       │ timeout     │ critical        │ explain
          │          │              │             │                 │
          ▼          ▼              ▼             ▼                 ▼
   ┌──────────┐ ┌──────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────────┐
   │ Resume   │ │REJECTION │ │timeout-rule │ │ Strategic   │ │  decision_log│
   │ workflow │ │LEARNING  │ │executor     │ │ escalator   │ │  reader      │
   │          │ │          │ │(auto_apv,   │ │ (page ops)  │ │              │
   │          │ │ DBSCAN   │ │ pause, etc) │ │             │ │              │
   └─────┬────┘ │ patterns │ └─────────────┘ └─────────────┘ └──────────────┘
         │      │          │
         │      │          ▼
         │      │   learned_adjustments
         │      │          │
         │      │          ▼
         │      │   inject prompts/principles/velocity/rules/QA into agents
         │      └────────────────────────────────────────┐
         │                                                │
         ▼                                                │
   ┌────────────────────────────────────────────────┐   │
   │            STRATEGIC LOOP (LangGraph)           │   │
   │                                                 │   │
   │  collect_signals ──► analyze_signals ──►        │   │
   │       ▲                                          │   │
   │       │                  plan_sprint ──►        │   │
   │       │                                          │   │
   │       │              interrupt(human gate) ──┐  │   │
   │       │                                       │  │   │
   │       │              resume after approval ──┘  │   │
   │       │                                          │   │
   │       │                  execute (delegate) ──┐ │   │
   │       │                                        │ │   │
   │       │   weekly digest ◄─────────────────────┘ │   │
   │  brain_snapshot frozen for run                   │   │
   └─────┬──────────────────────────┬─────────────────┘   │
         │ reads                     │ delegates           │
         ▼                           ▼                     │
   ┌─────────────────┐        ┌──────────────────────┐    │
   │  KNOWLEDGE      │        │  DELIVERY LAYER      │    │
   │  BASE           │        │  - design_docs       │    │
   │  - project_brain│        │  - conflict detect   │    │
   │  - signals      │        │  - branch strategy   │    │
   │  - tech docs    │        │  - PR gates          │    │
   │  - RAG (pgvec)  │        │  - feature flags     │    │
   │  - Magika       │        │  - canary controller │    │
   │    triage       │        │  - capability registry│   │
   └─────────────────┘        └────────┬─────────────┘    │
         ▲                              │                  │
         │ continuous update            │ commits/MRs       │
         │                              ▼                  │
         │                    ┌──────────────────────┐    │
         │                    │  EXTERNAL MCP        │    │
         │                    │  - GitLab (write)    │◄───┘
         │                    │  - OpenSearch (read) │
         │                    │  - Runner (compose)  │
         │                    │  - Tavily / arXiv    │
         │                    └────────┬─────────────┘
         │                              │
         │                              ▼
         │                    ┌──────────────────────┐
         │                    │  ENVIRONMENTS         │
         │                    │  local-dev, ephemeral,│
         │                    │  preview, dev, stag,  │
         │                    │  live (K8s)          │
         │                    └────────┬─────────────┘
         │                              │
         │                              │ logs flow back
         │                              ▼
         │                    ┌──────────────────────┐
         │                    │ MONITORING / INCIDENT│
         │                    │ alert_rules ↔        │
         │                    │ OpenSearch tail      │
         │                    └────────┬─────────────┘
         │                              │ incident → Auto Ops §4
         │                              ▼
         │                    ┌──────────────────────┐         ┌──────────────────┐
         │                    │ AUTO-ROLLBACK /      │◄────────┤ CANARY CONTROLLER│
         │                    │ INCIDENT HANDLER     │         └──────────────────┘
         │                    └────────┬─────────────┘
         │                              │ creates approval_item
         └──────────────────────────────┼──◄────► Approval Center
                                        │
   ┌────────────────────────────────────▼─────────────────────────────────────┐
   │                    SELF-HEALING / LIVENESS                                │
   │  liveness_heartbeats ◄── all agents emit                                  │
   │  watchdog (60s cron) ──► stuck_events ──► auto-recover OR escalate        │
   │  kill_switch (human or auto) ──► kill_events                              │
   │  workflow_health (60s aggregator)                                         │
   └───────────────────────────────────────────────────────────────────────────┘

   ┌────────────────────────────────────────────────────────────────────────────┐
   │                    INTERNAL AUDITOR (weekly)                               │
   │  reads decision_log, audit_reports, task_outcomes, llm_cost_log            │
   │  ──► drift detection, agent scoring, principle violations                  │
   │  ──► creates approval_items for critical findings                          │
   └────────────────────────────────────────────────────────────────────────────┘

   ┌────────────────────────────────────────────────────────────────────────────┐
   │                    EFFICIENCY REVIEWER (per-task)                          │
   │  per completed task: cost vs estimate, quality score                       │
   │  ──► task_efficiency_reviews                                               │
   │  ──► proposes efficiency_improvement_actions                               │
   │  ──► state machine (proposed→approved→implemented→verified)                │
   └────────────────────────────────────────────────────────────────────────────┘

   ┌────────────────────────────────────────────────────────────────────────────┐
   │              RELEASE TRAIN + ENV POINTER MACHINERY                          │
   │                                                                             │
   │   feature/* MRs ──► main (per-repo SemVer tag) ──► Train builder cron       │
   │                                                         │                   │
   │                                                         ▼                   │
   │                              ┌────────────────────────────────────┐         │
   │                              │  release_trains (state=ready)       │         │
   │                              │  trains/2026.04.W17.r3 = bundle    │         │
   │                              │  components: api@v1.2.3, web@v0.8.1│         │
   │                              └─────┬───────────────────┬───────────┘         │
   │                                    │ env/dev (auto)    │                     │
   │                                    ▼                   │                     │
   │                              ┌──────────────┐          │                     │
   │   PR Gate Tier 1 ─────────► │ Tier 2 quality │          │                     │
   │  (unit, lint, sec, axe,     │ (cross-browser │          │                     │
   │   visual, contract)         │  i18n, UX, persona,       │                     │
   │                             │  manual TC)    ◄─── Test Case Browser            │
   │                             └──────┬───────────────────┘                     │
   │                                    │ all green                               │
   │                                    ▼                                         │
   │                          Approval Center "Promote env/stag"                  │
   │                                    │ approve                                 │
   │                                    ▼                                         │
   │                              env/stag pointer tag move ──► canary             │
   │                                    │ canary clean                            │
   │                                    ▼                                         │
   │                          Approval Center "Promote env/live"                  │
   │                                    │ approve                                 │
   │                                    ▼                                         │
   │                              env/live pointer tag move                       │
   │                                    │                                         │
   │                                    ▼                                         │
   │                          Per-tenant cohort rollout advancer (cron 5m)         │
   └────────────────────────────────────────────────────────────────────────────┘

   ┌────────────────────────────────────────────────────────────────────────────┐
   │              HOTFIX FLOW (parallel to feature flow)                          │
   │                                                                             │
   │  Incident filed ──► Worktree spawner from `release/x.y` (current live)       │
   │       │                       │                                             │
   │       │                       ▼                                             │
   │       │               git worktree add /workspace/api/hotfix-INC-789         │
   │       │               (isolated from main feature work)                     │
   │       │                       │                                             │
   │       │                       ▼                                             │
   │       │              Engineer agent fix + commit `hotfix:` trailer           │
   │       │                       │                                             │
   │       │                       ▼                                             │
   │       │              MR vào release/x.y → PR Gate maintenance lane          │
   │       │              (full Tier 1 + canary, skip Tier 2 broad scope)         │
   │       │                       │                                             │
   │       │                       ▼                                             │
   │       │              Tag patch SemVer (vX.Y.Z+1) ──► env/live direct         │
   │       │                       │                                             │
   │       │                       ▼                                             │
   │       └──── Forward-port runner cron 1h: cherry-pick hotfix back to main     │
   │                       │                                                     │
   │                       │ 3 outcomes:                                         │
   │                       │  ① clean → auto-merge                                │
   │                       │  ② trivial conflict → agent resolve + retry          │
   │                       │  ③ deep conflict → escalate Approval Center          │
   │                       ▼                                                     │
   │              main updated with hotfix → next Train inherits                  │
   └────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Flow 1 — Daily 24h Cycle

Một ngày bình thường, không có sự cố:

```
00:00 ─┬─ Brain snapshot pruner (drop > 30 old per project)
       │
02:00 ─┼─ Uncertainty calibration cron
       │  └─ updates uncertainty_calibration.calibration_offset
       │
03:00 ─┼─ Rejection clustering (DBSCAN nightly)
       │  └─ rejection_patterns updated, may trigger learned_adjustments
       │
04:00 ─┼─ Doc staleness scorer
       │  └─ ranks tech_docs by staleness, flags top-N
       │
04:30 ─┼─ Outcome tracker (T+7 lookback)
       │  └─ compares Loop predictions vs actual → audit_reports
       │
       │  [continuous, every 60s throughout day]
       │  ├─ watchdog tick (stuck detection)
       │  ├─ alert evaluator (OpenSearch)
       │  └─ MCP health probes
       │
       │  [continuous, every 5 min]
       │  ├─ approval timeout sweeper
       │  ├─ cost guard scan
       │  └─ consistency invariant cron (30-min)
       │
       │  [event-driven all day]
       │  ├─ customer tickets → product_signals
       │  ├─ GitLab MRs / pipelines → PR gate
       │  ├─ Heartbeats from running agents
       │  ├─ Magika scans on commits
       │  ├─ Approvals submitted/rejected
       │  └─ Dev Flow: design → branch → MR → CI → canary → live
       │
       │  [hourly]
       │  └─ liveness compactor (heartbeats → workflow_health)
       │
17:00 ─┼─ (Friday only) Weekly digest sent
       │
23:59 ─┴─ Day rolls over

DAILY SUM:
- 1,440 watchdog ticks
- ~50-200 approvals processed
- ~10-50 PR pipelines
- ~5-20 efficiency reviews
- ~0-5 incidents (avg)
- Cost: ~$30-100 LLM (excl. agent task work)
```

---

## 5. Flow 2 — Weekly Strategic Cycle

Mondays là "thinking day" của Paperclip:

```
Monday 08:00 — STRATEGIC LOOP START
─────────────────────────────────────────────────────────────────────
Step 1: brain_snapshot taken (frozen for entire run)

Step 2: collect_signals node
  ├─ pull last 7d product_signals
  ├─ Tavily.search (competitor releases)
  ├─ arXiv.search (research)
  └─ rawSignals[] → state

Step 3: analyze_signals node
  ├─ LLM clusters signals into themes
  ├─ ranks by impact × frequency × novelty
  └─ themes[] with priority

Step 4: plan_sprint node
  ├─ filter themes by roadmap (forced load — from Rejection Learning §5.4)
  ├─ allocate effort (velocity * 5 days)
  ├─ assign agents (from agent_capabilities)
  ├─ compute uncertainty per task
  └─ proposed_sprint with N tasks

Step 5: routing
  IF max(task.uncertainty) > 0.4 OR high_blast_radius:
    interrupt(human gate)
    ──► approval_items entry created
    ──► STOP, wait for human
  ELSE:
    auto-proceed to execute

[HUMAN window: usually Mon afternoon or Tue]

  Case A: approve → resume workflow → tasks dispatched
  Case B: reject → Rejection Learning captures
                  ├─ category? wrong_estimate / out_of_roadmap / etc.
                  ├─ if cluster pattern → learned_adjustment applied
                  └─ Strategic Loop re-runs with new prompt
  Case C: timeout 36h → policy: auto_approve if all low-risk

Step 6: execute (after approval)
  └─ tasks → engineering agents → Dev Flow

Monday 09:00 — INTERNAL AUDITOR (after Loop produces output)
─────────────────────────────────────────────────────────────────────
- reads last week's task_outcomes, decision_log
- LLM-as-Judge scores Loop's quality
- drift detection (deviating from principles?)
- agent scoring (which agents over/under-performed)
- creates audit_reports
- if critical finding → approval_item HIGH risk

Monday afternoon onwards
─────────────────────────────────────────────────────────────────────
- Sprint executes through week
- Each completed task → Efficiency Reviewer
  - cost vs estimate
  - quality score
  - root cause if deviation
  - improvement_actions proposed if pattern

Friday 17:00 — Weekly Digest
─────────────────────────────────────────────────────────────────────
- summarize: shipped, blocked, incidents, costs, agent scores
- delivered via Slack + email
- includes "human attention items" not yet acted on

WEEKLY SUM:
- 1 Loop cycle
- 1 Auditor cycle
- 5-15 sprint tasks executed
- ~5-10 human approvals
- Cost: ~$200-500 LLM total
```

---

## 6. Flow 3 — Per-Feature End-to-End

Từ idea đến live:

```
T+0   PRODUCT SIGNAL OR HUMAN REQUEST
       │
       ▼ (Strategic Loop weekly OR direct intake)
T+7d  TASK PROPOSED IN SPRINT PLAN
       │
       ▼ (human approves sprint)
T+8d  ENGINEERING AGENT PICKED UP
       │
       ├─ checks agent_capabilities (skill match)
       ├─ acquires component_lock if needed
       ├─ checks design_docs for conflicts
       │  └─ if conflict → Approval Center (40-70 risk)
       │
       ▼
T+8d  DESIGN DOC DRAFTED
       │
       ├─ if new tech → approval (35-55 risk)
       │
       ▼ (approved)
T+9d  CODE GENERATION
       │
       ├─ creates branch: feature/ATO-1234-add-export
       ├─ writes code + tests
       ├─ Heartbeat emitted every 30s
       │  └─ if stuck → Self-Healing kicks in
       │
       ▼
T+10d MR OPENED
       │
       ├─ GitLab webhook fires
       ├─ CI/CD pipeline:
       │   ├─ lint
       │   ├─ test
       │   ├─ build
       │   ├─ security scan (3-layer + Magika disguise check)
       │   ├─ Optic API contract check
       │   │   └─ if breaking → approval (55-75 risk)
       │   └─ ephemeral preview spun up (Runner MCP)
       │
       ▼
T+10d PR GATE
       │
       ├─ if low-risk → auto-approve
       ├─ if high-risk → human approve (40-60 risk)
       │
       ▼ (approved + merged to develop)
T+10d AUTO-DEPLOY TO DEV
       │
       └─ K8s dev namespace, Paperclip watches via OpenSearch
       │
       ▼
T+11d MANUAL stag-* TAG (or auto if criteria met)
       │
       ├─ approval (40-70 risk)
       │
       ▼ (approved)
T+11d DEPLOY TO STAGING
       │
       └─ QA flows on preview env or stag
       │
       ▼
T+12d v*.*.* TAG + RELEASE
       │
       ├─ approval (40-70 risk) — always required
       │
       ▼ (approved)
T+12d CANARY TO LIVE
       │
       ├─ 5% → metrics watch 30 min
       ├─ 25% → metrics watch 1h
       ├─ 50% → approval (30-50 risk)
       │   └─ auto-approve if metrics OK
       ├─ 100% — promotion
       │
       ▼
T+12d FEATURE LIVE
       │
T+13d MONITORING WATCHES
       │
       ├─ if error spike → auto-rollback (uncertainty <0.2 → strict gate)
       │   └─ approval (80-95 risk) — human in 1h
       │
       ▼
T+19d (T+7) OUTCOME TRACKED
       │
       ├─ measured against predicted impact
       ├─ entered into task_outcomes
       │
       ▼
T+20d EFFICIENCY REVIEW
       │
       ├─ cost vs estimate
       ├─ quality score from Auditor
       ├─ if pattern → improvement_action proposed
       │
       ▼
T+27d (T+7 from Auditor) AUDIT REPORT
       │
       └─ Loop's decision quality scored
```

**Total elapsed:** ~12 days idea-to-live, ~27 days idea-to-fully-audited.
**Human time:** ~5-15 minutes spread across the journey.

---

## 7. Flow 4 — Per-Incident Response

Khi production có vấn đề:

```
T+0    LOG SPIKE / ERROR RATE BREACH
        │
        ▼ (OpenSearch alert via cron 60s)
T+90s  ALERT FIRES
        │
        ├─ alert_rules matched
        ├─ severity computed
        │
        ▼
T+95s  INCIDENT HANDLER WAKES
        │
        ├─ correlates with recent deploys (canary controller)
        ├─ checks workflow_health
        ├─ pulls last 1000 log lines
        │
        ▼
T+2m   DIAGNOSIS
        │
        ├─ if related to canary → auto-pause canary
        ├─ if related to recent migration → consult migration_reviews
        ├─ if MCP cascade → circuit break
        │
        ▼
T+2-5m AUTO-ACTION
        │
        ├─ Option A: rollback last release → uncertainty <0.2 → strict
        │            approval (80-95 risk, 1h timeout)
        ├─ Option B: scale up if capacity issue
        ├─ Option C: feature flag flip if new feature implicated
        │
        ▼
T+5-60m HUMAN APPROVES OR OVERRIDES
        │
        ├─ if approves rollback → executed via GitLab MCP
        ├─ if rejects → "what should we do?" → human directs
        │
        ▼
T+1h   POST-INCIDENT
        │
        ├─ stuck_event or incident logged
        ├─ Auditor scores response
        ├─ if pattern → improvement_action
        │
        ▼
T+24h  POST-MORTEM AUTO-DRAFTED
        │
        ├─ from logs + decision_log + approval trail
        ├─ proposed to human for review
        └─ becomes ADR if applicable
```

---

## 8. Flow 5 — Rejection Cascade

Human reject → system học:

```
T+0    HUMAN clicks Reject
        │
        ├─ mandatory dialog: categories[] + reason_details
        ├─ severity selected
        │
        ▼
T+5s   STORED in rejection_events
        │
        ├─ embedding computed (sentence-transformers)
        ├─ context captured (item type, project, agent)
        │
        ▼
T+5s   IMMEDIATE EFFECT
        │
        ├─ workflow status → REJECTED
        ├─ if Sprint Plan → Strategic Loop notified
        │   └─ may re-run plan_sprint with constraints
        ├─ if PR → engineering agent re-do or abandon
        ├─ if design → mark design_docs.status='rejected'
        │
        ▼
T+24h  NIGHTLY CLUSTERING (03:00)
        │
        ├─ DBSCAN over rejection_events.embedding
        ├─ new cluster_id assigned if matches existing pattern
        │
        ▼
T+24h+ PATTERN THRESHOLD CHECK
        │
        ├─ count >= 3 same agent + same category? → adjust agent prompt
        ├─ count >= 5 same project? → propose new principle
        ├─ estimate-related >= 5? → recalibrate velocity
        ├─ roadmap-violation >= 2? → force planner roadmap load
        │
        ▼
T+24h+ AUTO-ADJUSTMENT APPLIED
        │
        ├─ writes learned_adjustments
        ├─ injects into agent prompts / brain principles / planner rules
        │
        ▼
T+30d  EFFECTIVENESS MEASUREMENT
        │
        ├─ count recurrences post-application
        ├─ effectiveness = 1 - (rate_after / rate_before)
        ├─ if < 0.3 → revert + escalate
        │
        ▼
T+30d  CONVERGENCE CHECK
        │
        ├─ if pattern recurred 3+ times AFTER adjustment
        │   → "we-keep-failing-here" escalation
        │   → Approval Center HIGH risk: human strategic input
```

---

## 9. Flow 6 — Self-Heal Cascade

Workflow stuck:

```
T+0    AGENT SOMETHING WRONG
        │
        ▼ (heartbeat goes silent OR pattern detected)
T+5m   WATCHDOG DETECTS
        │
        ├─ heartbeat absent > 5 min OR
        ├─ same tool call > 10x in 5min (cosine sim 0.9) OR
        ├─ wait-graph cycle OR
        ├─ cost > 2x estimate OR
        ├─ MCP timeout cascade
        │
        ▼
T+5m   DIAGNOSIS
        │
        ├─ which failure_mode?
        ├─ evidence captured (last 50 tool calls, prompts)
        │
        ▼
T+5-7m AUTO-RECOVERY ATTEMPT
        │
        ├─ stalled → ping agent, wait 2min
        ├─ infinite loop → kill immediately
        ├─ deadlock → kill cycle, priority restart
        ├─ cost runaway → pause + snapshot
        ├─ MCP cascade → circuit break
        │
        ▼
T+8m   RESULT?
        │
        ├─ Recovered → write resolution_notes, log to stuck_events
        ├─ Failed → escalate
        │
        ▼ (escalate path)
T+8m   ESCALATION
        │
        ├─ approval_item created HIGH risk
        ├─ notification routed (push + Slack)
        ├─ workflow_health.composite_state = 'stuck'
        │
        ▼
T+8-60m HUMAN INVESTIGATES
        │
        ├─ uses Explain feature → reads decision_log
        ├─ chooses: kill / restart / disable agent / fix manually
        │
        ▼
T+60m+ POST-RESOLUTION
        │
        ├─ kill_events logged if killed
        ├─ refund unused budget to project
        ├─ stuck pattern → improvement_action proposed
```

---

## 10. Cross-Flow Interaction Matrix

Cùng 1 lúc, các flow chạy song song và tương tác:

| When this happens | These flows interact |
|-------------------|---------------------|
| Sprint plan rejected | Strategic Loop pauses → Rejection Learning captures → Loop re-plans → re-submits |
| Migration in canary fails | Canary auto-pauses → Migration rollback → Incident flow → human approves rollback |
| Agent stuck mid-MR | Self-Healing kicks in → MR not merged yet → human can kill → Engineering retries with new agent |
| Cost spike during Sprint | Cost guard pauses → all agents on pause → human approves continue or kill |
| Multiple rejections same pattern | Rejection cluster forms → adjustment applied → next Sprint Loop uses new prompt |
| MCP (GitLab) down | Circuit break → MR-related agents pause → ephemeral envs may fail → cascading slowdown → escalate after 10min |
| Magika finds disguised file | Security flag → PR Gate blocks → approval_item HIGH → human investigates supply chain |
| Brownfield onboard during normal ops | Magika scan runs (CPU-bound, doesn't conflict with LLM agents); KB indexing prioritized after; Strategic Loop deferred 1 week for new project |
| Greenfield Stage 4 (stack pick) rejected | Bootstrap pauses → Stage 5 invalidated → human picks alternative → Stage 5 re-runs with new stack |
| Production incident during Strategic Loop run | Loop pauses → incident takes priority → after resolved, Loop resumes with snapshot |

---

## 11. Failure Handoff Chain — "When X fails, Y picks up"

| Failure | First responder | Fallback | Final escalation |
|---------|----------------|----------|------------------|
| Agent stuck | Watchdog | Self-Healing kill + restart | Human via Approval Center |
| Tool call timeout | MCP wrapper retry (3x backoff) | Circuit break | Human if MCP down >10m |
| LLM API down | Provider fallback (Anthropic→OpenAI) | Queue tasks | Human if all providers down >5m |
| Postgres unavailable | App-level retry (5x) | Read replica fallback | Human + page ops |
| OpenSearch unavailable | Skip incident detection (degraded mode) | Cache last-known state | Human + page ops |
| Audit cycle fails | Skip this week, log | Re-run next day | Auditor self-flag |
| Strategic Loop crashes | Resume from PostgresSaver checkpoint | Manual re-run | Human investigates |
| Approval timeout reached | Per-type policy (auto_approve / pause / escalate) | Always log | Human if escalate |
| Canary metric ambiguous | Hold canary, no auto-advance | Wait for stabilization | Human decision |
| Conflict detection fails | Treat as conflict (safer) | Approval Center | Human resolves |
| Rejection clustering fails | Skip night, retry tomorrow | Manual cluster | Auditor flag |
| Magika service down | Fallback to extension-based (degraded) | Skip triage if fresh repo | Defer KB bootstrap |
| Workspace destroy fails | Mark for cleanup, retry hourly | Manual cleanup playbook | Ops |

---

## 12. Cost & Time Per Flow

| Flow | Frequency | Avg cost | Avg time | Human time |
|------|-----------|---------|---------|-----------|
| Daily 24h cycle | daily | ~$30-100 | continuous | 5-15 min |
| Weekly Strategic | 1/wk | ~$200-500 | 1h compute | 10-20 min |
| Per-feature E2E | ~5-15/wk | ~$5-30/feature | ~12 days | 5-15 min/feature |
| Per-incident | ~0-5/wk | ~$5-20 | <2h | 30-60 min |
| Per-rejection cascade | ~3-10/wk | ~$1-3 | seconds + nightly | 1-3 min |
| Per-self-heal | ~0-2/wk | ~$0.50-5 | <1h | 5-15 min |
| Brownfield onboard | rare | ~$50-150 | 4-8h | 30-60 min |
| Greenfield onboard | rare | ~$3.80-20 | ~4-8h | 30-60 min |

**Per project per week (steady state):**
- LLM cost: ~$300-1,000
- Compute: ~24h continuous
- Human time: ~30-40 min (north star)

---

## 13. Trigger → Document Map (reverse lookup)

Khi component X trigger, đọc doc nào:

| Trigger | Docs to consult |
|---------|----------------|
| New customer signal arrives | Strategic §3, KB §4 |
| Heartbeat goes silent | Self-Healing §3 |
| Approval submitted | Auto Ops §2 |
| Approval rejected | Rejection §3, §5 |
| MCP timeout | External §2, Self-Healing §3 |
| New PR | Dev Flow §4, Auto Ops §3, Magika §8, Git-Branch-Tag §11 |
| Canary metric breach | Dev Flow §5, Auto Ops §4 |
| Train ready to promote | Git-Branch-Tag §5–§6, Testing §15 |
| Hotfix incident filed | Git-Branch-Tag §7, Auto Ops §4, Cross-Repo §1 |
| Forward-port conflict | Git-Branch-Tag §7.5 |
| Manual TC submitted | Testing §17, UX §3 |
| Production synthetic probe fail | Testing §14 |
| Cron Strategic Loop fires | Strategic §4, §9 |
| Greenfield intake submitted | Greenfield §3 |
| Brownfield onboard | Magika §4, KB §3 |
| Decision logged | Decision-Boundary §5, UX §9 |
| Stuck event detected | Self-Healing §3 |
| Workflow killed | Self-Healing §5 |
| Conflict detected | Dev Flow §3 |
| Migration proposed | Auto Ops §6 |

---

## 14. North Star — Operational Health

| Metric | Target | Alert if |
|--------|--------|----------|
| Human time / project / week | < 40 min | > 60 min trending up |
| Auto-recovery success rate | > 80% | < 70% |
| Approval median time-to-decision | < 10 min | > 30 min |
| Rejection rate | < 15% | > 25% (sign of low Loop quality) |
| Stuck events / week / project | < 2 | > 5 |
| Cost per feature | < $30 | > $60 |
| Time idea-to-live | < 14 days | > 21 days |
| Incidents / week / project | < 1 | > 3 |
| Auditor critical findings / week | < 1 | > 3 |

---

## 15. Liên kết

Đọc ngược về docs nguồn:
- [[00-Master-Architecture-Overview]] — STRUCTURE (this is FLOW)
- [[Autonomous-PM-Strategic-Loop-Design]] — Strategic cycle detail
- [[Autonomous-Operations-and-Human-Gate-Design]] — Approval Center, CI/CD, monitoring
- [[Self-Healing-and-Liveness-Design]] — Watchdog, kill switch
- [[Rejection-Learning-and-Feedback-Loop]] — Learning cascade
- [[Decision-Boundary-and-Uncertainty-Model]] — Decision routing
- [[Development-Flow-and-Release-Strategy]] — Per-feature E2E
- [[External-Integrations-and-Environment-Strategy]] — MCP triggers
- [[Magika-Integration-and-Codebase-Triage]] — Triage trigger
- [[Greenfield-Bootstrap-Design]] — Birth flow
- [[Knowledge-Base-Management-Strategy]] — Continuous update
- [[UX-Strategy-and-Design]] — Notification routing
- [[Git-Branch-Tag-Release-Train-Strategy]] — Train + hotfix flow (§3 wiring)
- [[Testing-and-Quality-Assessment-Capability]] — PR Gate Tier 1/Tier 2 + manual TC
- [[Cross-Repo-Coordination-and-Decision-Hardening]] — Saga deploy + Brier calibration
