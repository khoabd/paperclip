---
title: UX Strategy & Design — Paperclip Autonomous System
tags: [architecture, ux, ui, design, userflow, information-architecture, personas]
created: 2026-04-29
status: design
related: "[[Autonomous-Operations-and-Human-Gate-Design]], [[Autonomous-PM-Strategic-Loop-Design]]"
---

# UX Strategy & Design — Paperclip Autonomous System

> Khi hệ thống tự vận hành, UI không còn là công cụ để "làm việc" — nó là **control tower**: thông báo đúng lúc, tối giản friction khi human cần quyết định, và luôn cho biết hệ thống đang khỏe mạnh không.

---

## 1. Design Philosophy — Autonomous System UI

### 1.1 Ba nguyên tắc cốt lõi

```
Nguyên tắc 1: SILENCE IS HEALTHY
─────────────────────────────────
Khi không có gì cần làm → UI im lặng.
Không có notification spam, không có "everything is running" badge.
Human mở app → thấy empty Approval Center → biết hệ thống ổn.

Nguyên tắc 2: INTERRUPTION = HIGH VALUE
────────────────────────────────────────
Mỗi lần hệ thống làm phiền human → phải thực sự quan trọng.
Notification fatigue = human ignore everything = system fails.
→ Risk scoring nghiêm ngặt, batch low-risk items.

Nguyên tắc 3: FULL AUDITABILITY
─────────────────────────────────
Human luôn có thể hỏi "tại sao hệ thống làm X?"
Mọi quyết định của Strategic Loop, Auditor, Agent đều traceable.
→ "Explain" button on everything.
```

### 1.2 UI Modes

```
AUTONOMOUS MODE (default 95% thời gian)
  → Human không cần làm gì
  → UI shows: system health summary + "0 items need your attention"
  → Human có thể browse history, audit logs, docs

ATTENTION MODE (5% thời gian)
  → Approval Center có items
  → UI shows: queue với risk scores, context, options
  → Human reviews, decides, done

INVESTIGATION MODE (on-demand)
  → Human wants to understand what's happening
  → Deep-dive: agent activity, logs, audit trails, knowledge base
```

---

## 2. User Personas

### Persona A — The Operator (primary)
```
Tên: "The Operator"
Là: Founder / CTO / Tech Lead của startup
Thói quen: Mở app 1-2 lần/ngày
Mục tiêu: "Biết hệ thống ổn và không cần tôi" + "Approve những gì cần"
Pain points hiện tại:
  - Không biết agents đang làm gì
  - Bị ping liên tục từ nhiều nguồn
  - Phải micromanage từng task
Cần từ Paperclip:
  - "Good morning" view: 3 numbers — done, in progress, needs you
  - Approval queue rõ ràng với context đầy đủ
  - Tin tưởng hệ thống tự chạy đúng
```

### Persona B — The Builder (secondary)
```
Tên: "The Builder"
Là: Developer, PM, hay QA muốn biết chi tiết
Thói quen: Mở app khi cần tra cứu hoặc review
Mục tiêu: "Xem design docs", "Review MR context", "Check QA status"
Cần từ Paperclip:
  - Knowledge base browser (API specs, sequence flows)
  - Issue detail với full context (agent logs, PR link, preview URL)
  - Audit trail: "agent đã làm gì với task này"
```

### Persona C — The Auditor (occasional)
```
Tên: "The Auditor"
Là: CTO / Senior Engineer review chất lượng định kỳ
Thói quen: Mở app cuối sprint (weekly/biweekly)
Mục tiêu: "Sprint có đạt goal không?", "System drift?", "Cost có ổn không?"
Cần từ Paperclip:
  - Sprint audit report (đẹp, có charts)
  - Efficiency heatmap
  - Cost breakdown
  - Drift score timeline
```

---

## 3. Information Architecture

### 3.1 Navigation Structure (Revised)

```
PAPERCLIP
│
├── 🏠 Command Center          ← NEW (replaces Dashboard)
│
├── ⚡ Approval Center         ← NEW (replaces current Approvals) — Sync #6 (autonomy-tuned)
│    ├── 🔴 Critical            ← Decide pattern: irreversible / blast radius high / Brier-bad
│    ├── 🟠 Pending Confirm     ← Confirm pattern: agent's high-conf proposal awaiting OK
│    ├── 🟡 Pending Choose      ← Choose pattern: agent gives 2-3 options, human picks
│    ├── 🟢 Pending Edit        ← Edit pattern: human tweaks before approve
│    ├── ✓ Auto-resolved        ← Trust-counter promoted these out of gate (audit trail)
│    ├── ⇡ Trust changes        ← Capability promotions/demotions this week
│    ├── ⇄ Cross-workspace      ← WFQ preemption events (Gap C)
│    ├── History
│    └── Settings (timeout, delegation, autonomy template)
│
├── 📥 Intake                  ← NEW (Human-Intake hub) — see [[Human-Intake-and-Solution-Loop-Design]]
│    ├── ＋ New Intake           ← form: type (problem/feature_request/bug_report/feedback/strategic/question) + workspace + body
│    ├── 🟢 In Triage            ← agent dedup + classify (< 60s)
│    ├── 🟠 Awaiting Approval    ← solution proposed, waiting Confirm/Choose/Edit/Decide
│    ├── 🔵 In Progress          ← mission(s) executing
│    ├── 🟣 In Soak               ← deployed, T+3d acceptance window
│    ├── ✓ Completed             ← outcome tracked (T+7 from Strategic §10)
│    ├── ✗ Rejected / Closed
│    ├── 📊 Feedback Clusters    ← DBSCAN themes (auto-promote at ≥5/14d)
│    └── History (per-submitter, per-workspace, per-type filters)
│
├── 🏢 Companies               ← existing
│
├── 📁 Projects
│    └── [Project Detail]
│         ├── Overview         ← existing (enhanced)
│         ├── Issues           ← existing
│         ├── Brain            ← NEW (Project Brain editor)
│         ├── Knowledge        ← NEW (docs, API specs, repos, dep graph)
│         ├── Designs          ← NEW (design docs lifecycle)
│         ├── Environments     ← NEW (ephemeral/preview/dev/stag/live)
│         ├── Health           ← existing (enhanced)
│         ├── Audit            ← NEW (sprint reports, efficiency, costs)
│         ├── Workspaces       ← existing
│         └── Settings         ← existing (config, budget)
│
├── 🤖 Agents
│    ├── All / Active / Paused / Error  ← existing
│    ├── Capabilities            ← NEW (skill matrix, routing rules)
│    └── New Agent               ← existing
│
├── 📋 Issues                  ← existing
├── 🔄 Routines                ← existing
├── 🎯 Goals                   ← existing
├── 💬 Inbox                   ← existing (enhanced with alert routing)
├── 💰 Costs                   ← existing (enhanced with LLM cost breakdown)
├── 📊 Activity                ← existing (enhanced as agent activity feed)
│
└── ⚙️ Settings                ← existing
```

### 3.2 Project Detail Tabs — Nhóm hợp lý

```
Thay vì quá nhiều tabs → nhóm theo context:

[Overview] [Issues] [Intake] [Brain+Knowledge] [Environments] [Audit] [Settings]

Each project page also has a sticky `＋ Intake` button (top-right) → opens intake form pre-filled with workspace_id; matches global Intake hub above. (See [[Human-Intake-and-Solution-Loop-Design]] §3 for entry-point spec.)

Click "Intake"          → side tabs: New | Active | Soak | Completed | Feedback Clusters
Click "Brain+Knowledge" → side tabs: Brain | Docs | API Specs | Repos | Dep Graph
Click "Environments"   → side tabs: Ephemeral | Preview | Dev | Stag | Live
Click "Audit"          → side tabs: Sprint | Efficiency | Coverage | Costs
```

---

## 4. Critical User Flows

### Flow 1 — "Good Morning" (daily, ~2 phút)

```
Human opens Paperclip
    │
    ▼
Command Center loads
    │
    ├── [0 items need attention] → đọc summary, close app → DONE
    │
    └── [3 items need attention] → click → Approval Center
             │
             ├── Item 1: DB Migration (risk 82) → Review → Approve → ✅
             ├── Item 2: Sprint Plan (risk 28)  → Scan → Approve All → ✅
             └── Item 3: Efficiency Fix (risk 8) → "Auto-approve in 2 days" → Skip
             │
             ▼
        All done → back to Command Center → "0 items" → close
```

**Màn hình Command Center:**
```
┌──────────────────────────────────────────────────────────────────┐
│  Good morning, Khoa                          Tue, Apr 29         │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  ⚡ 3 items   │  │  ✅ 12 done  │  │  🤖 8 agents active  │  │
│  │  need you    │  │  this week   │  │  0 errors            │  │
│  │  [Review]    │  │              │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                                                                   │
│  PROJECTS                                                         │
│  ┌────────────────────────────────────────────────┐             │
│  │  ATO  ████████████░░░░  68%  ·  2 blocked  ✅  │             │
│  │  UFI  ███░░░░░░░░░░░░░  22%  ·  0 blocked  ✅  │             │
│  └────────────────────────────────────────────────┘             │
│                                                                   │
│  SYSTEM HEALTH                          last checked 2 min ago  │
│  payment-service  ●  live healthy                               │
│  order-service    ●  live healthy                               │
│  frontend         ●  live healthy                               │
└──────────────────────────────────────────────────────────────────┘
```

---

### Flow 2 — Approve Sprint Plan (weekly, ~5 phút)

```
Strategic Loop runs → creates approval item
    │
    ▼
Human gets notification (Slack/push/email — based on settings)
    │
    ▼
Opens Approval Center → Sprint Plan item
    │
    ▼
Sprint Plan Approval Panel:
  LEFT: Proposed tasks (3 items) với context
  RIGHT: Why — top customer pains, market research, competitor insight
    │
    ├── Human reads context
    ├── Edits task 2 (changes complexity S→M)
    ├── Removes task 3 (doesn't align with vision)
    └── Approves task 1 + edited task 2
    │
    ▼
System creates issues → assigns to agents → autonomous execution
```

**Sprint Plan Approval UI:**
```
┌─────────────────────────────────────────────────────────────────┐
│  SPRINT PLAN APPROVAL — Week 19              risk: 28 (MEDIUM)  │
├───────────────────────────┬─────────────────────────────────────┤
│  PROPOSALS                │  WHY THESE?                         │
│                           │                                     │
│  ✅ Agent Observability   │  Top pain this week:                │
│     Dashboard             │  "Agents bị stuck" — 12 tickets     │
│     Complexity: M · 3d    │  Churn risk: HIGH                   │
│     Dept: Engineering     │                                     │
│                           │  Competitor signal:                  │
│  ✏️ Add cost-per-feature  │  Devin shipped live terminal        │
│     Complexity: S→M       │  Users love observability           │
│     [Edit]                │                                     │
│                           │  Research:                           │
│  🗑️ Dark mode toggle      │  "UI visibility top request         │
│     [Remove — low impact] │   in Q1 user interviews"            │
│                           │                                     │
├───────────────────────────┴─────────────────────────────────────┤
│  [Approve Selected (2)]   [Approve All]   [Reject All]          │
│  [Request Changes — tell Loop what to adjust]                   │
└─────────────────────────────────────────────────────────────────┘
```

---

### Flow 3 — Incident Response (~10 phút)

```
Monitoring detects error spike on payment-service (live)
    │
    ▼
Approval Center: "Critical incident" (risk 88) + push notification
    │
    ▼
Human opens incident:
  - Error rate: 4.2% (threshold: 1%)
  - Affected: POST /api/payments — 3 errors/min
  - Log sample: "TypeError: Cannot read property 'currency' of undefined"
  - Agent ATO-Engineering-1 already investigating (auto-assigned)
    │
    ├── Option A: "Let agent investigate" (default) → wait
    ├── Option B: "Rollback now" → triggers GitLab pipeline → revert
    └── Option C: "I'll fix manually" → pause agent, open MR link
    │
    ▼ (chose A — let agent investigate)
    │
    ▼ Agent posts update (15 min later)
  "Root cause: missing null check in currency parser.
   Fix committed to feature/hotfix-ATO-530.
   Preview environment: https://preview-530.dev.company.com"
    │
    ▼
Human reviews preview → Approval Center: "Merge hotfix?" (risk 70)
    │
    ▼ Approve → GitLab merges → deploy live → incident resolved
```

---

### Flow 4 — New Project Onboarding (~30 phút one-time)

```
Human adds new project to Paperclip
    │
    ▼
Step 1: Register repos
  → GitHub/GitLab org import → select 3 repos → confirm
    │
    ▼
Step 2: Bootstrap runs (automated, ~15 min)
  → Progress screen: "Scanning repos... Generating docs... Building dep graph..."
    │
    ▼
Step 3: Bootstrap Report
  → Shows: what was found, confidence scores, items needing review
  → Human corrects: unknown dependency, missing env var description
    │
    ▼
Step 4: Seed Project Brain
  → Simple form: goal, vision, phase, key constraints
  → NOT a JSON editor — structured form with examples
    │
    ▼
Step 5: Configure environments
  → Link GitLab projects → confirm branch conventions
  → Link OpenSearch index patterns
    │
    ▼
System starts monitoring. Strategic Loop schedules first run (next Monday).
```

**Bootstrap Progress Screen:**
```
┌──────────────────────────────────────────────────────────────────┐
│  Bootstrapping ATO Project                                        │
│                                                                   │
│  ████████████████████████████████░░░░░░░  78%                   │
│                                                                   │
│  ✅  Repos discovered (3)                                        │
│  ✅  Languages detected: TypeScript, Python                      │
│  ✅  API specs generated (3 services)                            │
│  ✅  ERDs generated (2 databases)                                │
│  ⏳  Generating sequence flows...  (4/6 done)                    │
│  ○   Building dependency graph                                    │
│  ○   Coverage gap detection                                       │
│                                                                   │
│  Estimated time remaining: ~3 minutes                            │
└──────────────────────────────────────────────────────────────────┘
```

---

### Flow 5 — Weekly Audit Review (~10 phút)

```
Every Monday morning: Audit report ready in Inbox
    │
    ▼
Human opens Audit → Sprint 5 Report
    │
    ├── Overall scores: Loop 72, Outcome 85, Agent 68, Drift 91
    ├── Proposal audit: 2 success, 1 low-value, 1 busy-work
    ├── Agent alert: agent-qa-1 consistently slow (45/100)
    └── 2 findings: [MEDIUM] + [LOW]
    │
    ├── Click finding [MEDIUM] → "add phase filter to Loop prompt"
    │   → Approve fix → creates Paperclip issue automatically
    │
    └── Click agent-qa-1 → Agent detail → Capabilities tab
        → See: TypeScript 45/100, avg 9.1h/task
        → Action: "Reassign QA tasks to engineering agent"
```

---

## 5. Screen Designs — New Features

### 5.1 Project Brain Editor

```
┌──────────────────────────────────────────────────────────────────┐
│  PROJECT BRAIN — ATO                              [Edit] [Save]  │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  🎯 GOAL                                                          │
│  "Build FCTCAI — AI company simulation platform, ship v1 Q3 2026"│
│                                                                   │
│  🔭 VISION                                                        │
│  "Every startup can have a fully autonomous AI team"             │
│                                                                   │
│  📍 PHASE       [core_agents_mvp ▼]                              │
│                                                                   │
│  ⚠️ KNOWN GAPS                                    [+ Add Gap]    │
│  • no persistent memory across agent runs          [✅ Fixed]    │
│  • no project context injected into agents         [🔄 In progress]│
│  • no customer feedback loop                       [○ Open]      │
│  • adapter fallback not wired                      [✅ Fixed]    │
│                                                                   │
│  🚫 CONSTRAINTS                                   [+ Add]        │
│  • Python 3.11+  • LangGraph only  • Budget $200/mo LLM         │
│                                                                   │
│  📊 METRICS (this week)                                          │
│  WAU: —    Retention: —    NPS: —    Velocity: 12 tasks/sprint   │
│                                                                   │
│  📋 KEY DECISIONS                                 [+ Add ADR]    │
│  Apr 24  Pure LangGraph stack     [Accepted]  [View]             │
│  Apr 25  Multi-dept model          [Accepted]  [View]             │
└──────────────────────────────────────────────────────────────────┘
```

### 5.2 Knowledge Base Browser

```
┌──────────────────────────────────────────────────────────────────┐
│  KNOWLEDGE BASE — ATO              [+ Add Doc]  [🔍 Search...]   │
├────────────┬─────────────────────────────────────────────────────┤
│  FILTER    │  API SPECS (3)                                       │
│            │  ┌────────────────────────────────────────────────┐ │
│  Type      │  │ payment-service  v2.3.1  ● current  [View]     │ │
│  ○ All     │  │ order-service    v1.8.0  ● current  [View]     │ │
│  ● API     │  │ frontend-bff     v1.2.0  ⚠ needs review [View] │ │
│  ○ Seq     │  └────────────────────────────────────────────────┘ │
│  ○ ERD     │                                                      │
│  ○ Arch    │  SEQUENCE FLOWS (5)                                  │
│  ○ ADR     │  ┌────────────────────────────────────────────────┐ │
│            │  │ checkout-flow      ● fresh     [View] [Edit]   │ │
│  Repo      │  │ payment-flow       ● fresh     [View] [Edit]   │ │
│  ○ All     │  │ auth-flow          ⚠ 94d old   [View] [Update] │ │
│  ● payment │  │ order-status-flow  ● fresh     [View] [Edit]   │ │
│  ○ order   │  │ refund-flow        ● fresh     [View] [Edit]   │ │
│  ○ frontend│  └────────────────────────────────────────────────┘ │
│            │                                                      │
│  Status    │  DEPENDENCY GRAPH                     [View Full]   │
│  ○ All     │  ┌────────────────────────────────────────────────┐ │
│  ⚠ Stale  │  │  frontend ──HTTP──▶ payment-service            │ │
│            │  │  frontend ──HTTP──▶ order-service              │ │
│            │  │  order-service ──HTTP──▶ payment-service        │ │
│            │  │  ⚠ payment-service ──[?]:8080──▶ unknown       │ │
│            │  └────────────────────────────────────────────────┘ │
└────────────┴─────────────────────────────────────────────────────┘
```

### 5.3 Environment Dashboard

```
┌──────────────────────────────────────────────────────────────────┐
│  ENVIRONMENTS — ATO / payment-service                            │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  LOCAL          EPHEMERAL           PREVIEW                      │
│  ─────          ─────────           ───────                      │
│  No visibility  ATO-530 (active)    MR !142 (QA in progress)    │
│                 feature/hotfix      preview-142.dev.co...        │
│                 ● api ● db ● redis  [Open Preview] [QA Logs]    │
│                 [View Logs]                                       │
│                                                                   │
│  ────────────────────────────────────────────────────────────── │
│                                                                   │
│  DEV            STAG                LIVE                         │
│  ─────          ─────               ─────                        │
│  v2.3.1-abc123  v2.3.0              v2.2.9                       │
│  ● Healthy      ● Healthy           ● Healthy                    │
│  deployed 2h    deployed 3d         deployed 8d                  │
│  ago            ago                 ago                          │
│                                                                   │
│  [View Logs]    [View Logs]         [View Logs]                  │
│                 [Promote →]         (canary: 100%)               │
│                                                                   │
│  ────────────────────────────────────────────────────────────── │
│  PROMOTE STAG → LIVE                                             │
│  Current STAG: v2.3.0 (3 days, 0 incidents, E2E: ✅)           │
│  [Create Release v2.3.0] ← creates approval item in center      │
└──────────────────────────────────────────────────────────────────┘
```

### 5.4 Agent Activity Feed

```
┌──────────────────────────────────────────────────────────────────┐
│  ACTIVITY — ATO                    [Filter: All ▼]  [Live ●]    │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  NOW                                                             │
│  🤖 agent-engineering-1  working on ATO-530 (hotfix)           │
│     "Reading checkout.controller.ts via GitLab MCP..."          │
│     Branch: feature/ATO-530-fix-currency  [View MR]             │
│                                                                   │
│  🤖 agent-qa-1           testing ATO-512 on Preview             │
│     "Running E2E checkout flow test... 3/8 passed"              │
│     Preview: preview-142.dev.company.com  [Open]                 │
│                                                                   │
│  TODAY                                                           │
│  ✅ 14:22  agent-devops-1   Deployed ATO-515 to dev (v2.3.1)   │
│  ✅ 13:45  agent-engineering-1  Merged MR !141 (ATO-515)        │
│  ⚠️ 12:30  agent-qa-1      E2E failed on ATO-515 preview        │
│            [View Error]  → fixed at 13:10                        │
│  ✅ 11:00  Strategic Loop  Sprint plan created  [View Plan]      │
│                                                                   │
│  YESTERDAY                              [Load more...]           │
│  ✅ 16:45  Auditor         Sprint 5 report ready  [View Report] │
│  ✅ 15:20  agent-engineering-2  Merged MR !140 (ATO-513)        │
└──────────────────────────────────────────────────────────────────┘
```

### 5.5 Efficiency Review Detail

```
┌──────────────────────────────────────────────────────────────────┐
│  EFFICIENCY REVIEW — ATO-512 "Add dark mode toggle"   MEDIUM 🟡  │
├──────────────────────────────────────────────────────────────────┤
│  METRICS vs BASELINE (Complexity: S)                             │
│                                                                   │
│  Duration   ████████████░░  11h  (baseline 2h)   ▲5.5x         │
│  Cost       ████████████░░  $0.62 (baseline $0.05) ▲12.4x ⚠️   │
│  Quality    ████████░░░░░░  71/100               ✓ adequate     │
│  Retries    7  (normal: 0-1)                                     │
│                                                                   │
│  ROOT CAUSES                                                      │
│  🔴 missing_context (91%)                                        │
│     "Agent asked 'where is theme config?' 4 times.              │
│      No codebase map in project brain."                          │
│  🟠 ambiguous_spec (74%)                                         │
│     "No acceptance criteria for which components need dark mode"│
│                                                                   │
│  IMPROVEMENT PROPOSALS                                           │
│  ┌─────────────────────────────────────────────────┐           │
│  │ ✅ add_context  effort:S  saving: ~70% cost      │           │
│  │    Inject codebase_map into agent payload        │           │
│  └─────────────────────────────────────────────────┘           │
│  ┌─────────────────────────────────────────────────┐           │
│  │ ✅ add_acceptance  effort:S  saving: less retries│           │
│  │    Auto-generate AC template for UI tasks        │           │
│  └─────────────────────────────────────────────────┘           │
│                                                                   │
│  [Approve Selected]   [Reject — False Positive]   [Skip]        │
└──────────────────────────────────────────────────────────────────┘
```

---

## 6. Notification UX

### 6.1 Notification Hierarchy

```
LEVEL 1 — Critical (risk ≥80)
  Channels: Push notification + Slack DM + Email
  Content: What happened, what's at risk, 1-tap action
  Timing: Immediately, ignore quiet hours
  Example: "🔴 Payment service error rate 4.2% — Rollback or Investigate?"

LEVEL 2 — High (risk 50-79)
  Channels: Push notification + Slack
  Content: What needs decision, brief context
  Timing: Immediately during work hours
  Example: "⚠️ DB migration ready for review (affects 45k rows)"

LEVEL 3 — Medium (risk 30-49)
  Channels: Approval Center badge + Slack (once/4h digest)
  Content: Item title + risk score
  Timing: Batched, not immediate
  Example: Badge "3 items" on Approval Center

LEVEL 4 — Low (risk <30)
  Channels: Daily digest email (9am)
  Content: List of items, 1-click batch approve
  Timing: Daily summary only
  Example: "5 low-risk items auto-approved today; 2 pending your review"
```

### 6.2 Notification Settings UI

```
┌──────────────────────────────────────────────────────────────────┐
│  NOTIFICATION SETTINGS                                           │
│                                                                   │
│  Quiet Hours    22:00 — 08:00  GMT+7       [Edit]               │
│  Critical override: ON (Critical alerts bypass quiet hours)      │
│                                                                   │
│  CHANNELS                                                        │
│  Push (mobile)   ● Critical  ● High  ○ Medium  ○ Low           │
│  Slack DM        ● Critical  ● High  ○ Medium  ○ Low           │
│  Email           ● Critical  ○ High  ○ Medium  ● Daily Digest  │
│  In-app badge    ● All                                           │
│                                                                   │
│  AUTO-APPROVE                                                    │
│  Risk < 20: auto-approve after  [48h ▼]                         │
│  Budget warnings: auto-pause spending after [12h ▼]              │
│                                                                   │
│  DELEGATION                                                      │
│  If I'm unavailable for > [24h ▼]:                              │
│  Delegate high-risk to: [teammate@company.com]                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 7. Mobile UX Strategy

> Approval Center phải usable trên điện thoại — human approves từ bất kỳ đâu.

### 7.1 Mobile-First cho Approval Flow

```
Mobile Approval Card:
┌──────────────────────────────┐
│ ⚠️ HIGH RISK · Apr 29 14:32  │
│                              │
│ DB Migration                 │
│ payment-service              │
│                              │
│ Adds currency_code (NOT NULL)│
│ Affects 45k rows             │
│ Rollback: ready ✅           │
│                              │
│ [View Details ↗]             │
│                              │
│ ┌──────────┐  ┌───────────┐ │
│ │ Reject   │  │  Approve  │ │
│ └──────────┘  └───────────┘ │
│    [Defer 24h]               │
└──────────────────────────────┘
```

### 7.2 Mobile Rules
- Approval cards: swipe right = approve, swipe left = defer
- Critical items: full-screen takeover on open
- Log viewer: not available on mobile (redirect to desktop)
- Knowledge base: read-only on mobile

### 7.3 Per-pattern mobile rendering — Gap E

| Pattern | Mobile UX | Push level | Apple Watch |
|---|---|---|---|
| **Confirm** | Full card + diff snippet + 2 buttons; swipe right = approve, swipe left = reject; long-press = details | silent push | Quick action: Approve inline |
| **Choose** | Horizontal swipe-able tabs cho N options; tap to select; swipe up confirm | silent push | Show summary only, defer to phone |
| **Edit** | Tap-to-edit compact form (key fields only); full edit ⇒ desktop redirect | preview push | Defer to phone |
| **Decide** | "Open on desktop" CTA + summary; sends desktop push | critical push | Notification only, no action |

Notification matrix per autonomy level:

| Autonomy | Confirm | Choose | Edit | Decide |
|---|---|---|---|---|
| sandbox | digest | digest | digest | push |
| high | digest | digest | push | push |
| medium | silent | silent | push | push |
| low | push | push | push | push |

### 7.4 Cross-workspace activity panel — Gap C

Approval Center (mobile + desktop) thêm collapsible panel "Cross-workspace activity (24h)":
- List preemption events (`from_workspace → to_workspace, mission, duration_lost_min`)
- Per workspace card badge: "+3h lent / -2h borrowed this week"
- Inline action: "Pin workspace quota" (toggle `workspace.pin_quota=true`)
- Critical preemption (mission > 30 min lost) → escalates to Critical pattern

Schema:
```sql
CREATE TABLE mobile_action_log (
  approval_id   UUID,
  decided_on    TEXT,        -- 'mobile' | 'watch' | 'desktop'
  pattern       TEXT,        -- 'confirm' | 'choose' | 'edit' | 'decide'
  latency_ms    INT,
  decided_at    TIMESTAMPTZ
);
```

→ Nightly aggregate cho audit/efficiency review (xem [[Autonomous-PM-Strategic-Loop-Design]] §17).

---

## 8. Empty States & Loading

### 8.1 Healthy Empty States (positive framing)

```
Approval Center — Empty:
┌──────────────────────────────────────────────────────────────────┐
│                                                                   │
│                    ✅                                            │
│            Nothing needs your attention                          │
│                                                                   │
│    The system is running autonomously.                           │
│    You'll be notified when something needs a decision.           │
│                                                                   │
│         [View Recent History]   [Check System Health]           │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘

Agent Activity — Quiet:
  "All agents are idle. No active tasks."
  [View last 7 days] [Create task manually]

Efficiency Reviews — All Good:
  "No efficiency issues detected in the last 14 days. 🎉"
```

### 8.2 Error States

```
OpenSearch Unavailable:
  "Log data temporarily unavailable. Agents continue working.
   Incident detection paused — manual monitoring recommended."
  [Check OpenSearch status]

GitLab MCP Offline:
  "GitLab connection lost. Agent tasks paused (branches/commits blocked).
   In-progress work is safe."
  [Retry connection]  [View affected tasks]

Bootstrap Failed:
  "Bootstrap stopped at 'Generating sequence flows' (3/6 done).
   Partial results saved. You can retry or continue manually."
  [Retry from checkpoint]  [Review partial results]
```

---

## 9. "Explain" — Auditability Pattern

> Mọi quyết định của hệ thống đều có nút **[Explain]** — human có thể hỏi tại sao.

```typescript
// Mọi action quan trọng đều log reasoning
interface AuditableAction {
  id: string;
  type: string;                // 'strategic_loop_proposal' | 'agent_decision' | 'auto_approve'
  summary: string;             // 1 câu ngắn
  reasoning: string;           // LLM-generated explanation
  evidence: Evidence[];        // data points used (signals, metrics, docs)
  alternativesConsidered: string[]; // what else was considered
  timestamp: Date;
}

// UI: every card has [Explain] button → opens reasoning panel
```

```
EXPLAIN: Why was "Agent Observability Dashboard" proposed?

Strategic Loop reasoning (Apr 29, 11:00):
  "This task addresses the top customer pain from last 7 days.
   12 support tickets about 'agents stuck with no visibility'
   represent HIGH churn risk based on sentiment analysis.
   
   Competitor signal: Devin.ai shipped a terminal view feature
   last week and users praised it in public forums.
   
   Current codebase analysis shows no observability component
   exists in frontend (confirmed via Knowledge Base scan).
   
   Estimated impact: fixes 12 open tickets, reduces HIGH churn
   risk for affected users. Complexity M is justified by
   the number of components requiring changes (3 services)."

Evidence used:
  · 12 support tickets (product_signals table)
  · Devin.ai research (Tavily search, Apr 28)
  · Codebase scan: no observability component found
  · Churn risk model: HIGH for 'visibility' category
```

---

## 10. Implementation Roadmap — UI

### Phase 0f — Command Center + Approval Center (3-4 ngày)
- [ ] Command Center page (replaces Dashboard for autonomous overview)
- [ ] Approval Center redesign (queue + risk badges + batch approve)
- [ ] Notification settings page
- [ ] Mobile: approval card swipe gestures

### Phase 1f — Project Brain + Knowledge Base (3-4 ngày)
- [ ] Project Brain editor tab (structured form, not JSON)
- [ ] Knowledge Base browser (filter by type/repo/freshness)
- [ ] API Spec viewer with version diff
- [ ] Dependency Graph visualization (D3/Cytoscape)

### Phase 2f — Environments + Activity (2-3 ngày)
- [ ] Environment Dashboard tab (all 6 envs in one view)
- [ ] Promotion wizard (stag→live with approval flow)
- [ ] Agent Activity Feed (live + historical, with Explain)
- [ ] Ephemeral workspace status panel

### Phase 3f — Audit + Efficiency (2-3 ngày)
- [ ] Sprint Audit Report page (charts, scores, findings)
- [ ] Efficiency Review detail + approval flow
- [ ] Cost breakdown (LLM cost by agent, task, sprint)
- [ ] Doc Coverage dashboard

### Phase 4f — Bootstrap + Onboarding (2-3 ngày)
- [ ] New Project wizard (repos → bootstrap → brain seed → envs)
- [ ] Bootstrap progress screen + report review
- [ ] First-time user onboarding flow

### Phase 5f — Mobile + Polish (2 ngày)
- [ ] Mobile Approval Center (swipe gestures)
- [ ] Push notification setup
- [ ] Empty states + error states across all new screens
- [ ] "Explain" button on all strategic decisions

---

## 11. Liên kết

- [[Autonomous-Operations-and-Human-Gate-Design]] — Approval Center backend design
- [[Autonomous-PM-Strategic-Loop-Design]] — Strategic Loop, Auditor
- [[Knowledge-Base-Management-Strategy]] — Knowledge Base backend
- [[External-Integrations-and-Environment-Strategy]] — Environments, GitLab, OpenSearch
