---
tags: [architecture, intake, human-input, feedback, workflow, P0]
date: 2026-04-29
status: design
priority: P0
depends_on:
  - "[[Autonomous-PM-Strategic-Loop-Design]]"
  - "[[Autonomy-Dial-and-Progressive-Trust-Design]]"
  - "[[UX-Strategy-and-Design]]"
  - "[[Decision-Boundary-and-Uncertainty-Model]]"
  - "[[Self-Healing-and-Liveness-Design]]"
  - "[[Greenfield-Bootstrap-Design]]"
---

# Human Intake & Solution Loop Design

> **Mục đích:** Cung cấp explicit entry point cho human-direct input vào IN-FLIGHT products. Khác với Greenfield (NEW project) và Strategic Loop signals (automated pull), Human Intake Hub là **anh chủ động nói "fix Y cho product X" / "feature mới Z" / "feedback về release N"** rồi follow giải pháp end-to-end với timeline + approve.

---

## 1. Vấn đề + use cases

### 1.1 Existing coverage map

| Channel | Source | Status |
|---|---|---|
| Greenfield Bootstrap | Wizard cho NEW project | ✅ Cover (Greenfield §3.1-§3.7) |
| Strategic Loop signals | Sentry, support ticket, rejection_events, competitor crawler | ✅ Cover (Autonomous-PM §3) |
| Approval Center | Agent → human gate (outbound) | ✅ Cover (UX-Strategy §3, Autonomy-Dial §11) |
| **Human → product intake** | **anh nhập vấn đề/feature/feedback cho product đang chạy** | ❌ **GAP** |

### 1.2 7 use cases trong scope

1. **Problem-driven**: "Onboarding flow của FitTracker drop 40%, fix đi"
2. **Feature-driven**: "Add export-to-PDF cho dashboard của AdminTool"
3. **Bug report**: "Login button broken trên iOS 17.2 production"
4. **Release feedback**: "Update v3.7.2 release hôm qua, latency tăng — review impact"
5. **Feature feedback**: "Feature 'auto-categorize' không work với người Việt"
6. **Strategic input**: "Pivot FitTracker từ B2C sang B2B SMB, update brain"
7. **Question**: "Architecture quyết định Postgres thay MongoDB là vì sao?"

→ Tất cả 7 cần **trace từ chỗ anh nhập → end-to-end giải pháp + approve**.

### 1.3 Goal

- Single console entry point cho human → in-flight product
- Auto-classify intake type → route to correct workflow
- Show timeline estimate (P50/P90) ngay sau triage (< 5 min)
- Real-time progress + approval markers
- Acceptance loop: anh xác nhận giải pháp đáp ứng vấn đề ban đầu

---

## 2. Intake taxonomy

### 2.1 Type table

| Type | Symbol | Trigger phrase | Owner agent chain |
|---|---|---|---|
| `problem` | 🔴 | "X is broken/suboptimal, fix" | Diagnostician → Architect → Engineer → QA |
| `feature_request` | 🟢 | "Add Y" | PM → Architect → Engineer → QA |
| `bug_report` | 🐞 | "Y broken specifically, with repro" | QA → Engineer |
| `feedback_general` | 💬 | "I think X..." (no specific ask) | Aggregator (passive) |
| `feedback_release` | 📦 | Tied to release tag | Release analyst |
| `feedback_feature` | 🎯 | Tied to feature_key | Feature health analyzer |
| `strategic_input` | 🧭 | "Change direction Y" | PM Strategic + Auditor |
| `question` | ❓ | "How does Y work?" | KB search agent |

### 2.2 Auto-classifier

LLM classifier trên text + attachments, output `{type, confidence, suggested_workspace, alternative_types}`. Confidence < 0.7 → human chooses (Choose pattern, max 2 candidates).

```python
def classify_intake(text, attachments, recent_workspace_activity):
    prompt = f"""
    Classify into one of 8 types: {TYPES}.
    Heuristics:
    - "broken" / "fix" / "không hoạt động" → problem or bug_report
    - "thêm" / "add" / "tính năng" → feature_request
    - "review" / "feedback" / "đánh giá" → feedback_*
    - "tại sao" / "how" → question
    - "pivot" / "đổi hướng" → strategic_input
    Repro steps + specific platform → bug_report (vs problem)
    Tied to release tag → feedback_release
    """
    return parse(llm.invoke(prompt, text + attachments_summary))
```

---

## 3. Console UX — entry points

### 3.1 Surfaces

| Surface | Mechanism |
|---|---|
| Top-bar global | `+ New Intake` button (visible mọi page) |
| Workspace card | `+ Intake` button per-workspace |
| API | `POST /intake` (CLI, integrations) |
| Email | `intake@<workspace_slug>.paperclip` (parser auto-detects type) |
| Mobile | `📥 Capture` button (voice + screenshot) |
| Approval Center rejection | "+ Submit related intake" trong rejection feedback box |

### 3.2 Wizard flow (desktop)

1. **Workspace pick** — auto-suggest từ recent activity, skip nếu chỉ 1 active
2. **Type pick OR auto-classify** — skip nếu confidence > 0.7
3. **Free-text description + attachments** (screenshot, log, video, URL)
4. **Optional fields:** submitter mood (1-5), linked release tag, linked feature_key, priority hint
5. **Submit** → instant `intake_id` + L1 timeline estimate displayed (< 5s)

### 3.3 Mobile quick capture

```
┌────────────────────────┐
│ 📥 Capture             │
├────────────────────────┤
│ [🎤 hold to record]    │
│ "Login broken iOS..."  │
│ [📷 Add screenshot]    │
│ Workspace: AdminTool ▾ │
│ Type: bug_report (auto)│
│ [   Submit   ]         │
└────────────────────────┘
```

→ Auto-routed, anh nhận push khi có L2 ETA hoặc first approval needed.

---

## 4. Triage + routing

### 4.1 Triage agent (always first stage, < 5 min)

1. Classify type (if not pre-set)
2. **Duplicate detection** — cosine sim > 0.85 với open intakes → propose merge
3. **Priority** computation (P0/P1/P2/P3 từ severity + impact)
4. Route to workspace mission orchestrator
5. Emit L1 ETA (class-based bracket — see §6)
6. Set state = `triaged`

### 4.2 Duplicate handling

| Sim score | Action |
|---|---|
| > 0.85 | Propose merge với existing intake (Confirm pattern, 1 click) |
| 0.70-0.85 | Notify "similar exists" + proceed if anh confirms different |
| < 0.70 | Unique, proceed |

### 4.3 Priority computation

```python
def priority(intake):
    score = 0
    if intake.type == 'bug_report':
        score += {'crash':30, 'data_loss':50, 'broken_flow':20, 'visual':5}[intake.severity]
        score += intake.affected_users_estimated // 100
    elif intake.type == 'problem':
        score += revenue_impact_score(intake)
    elif intake.type == 'feature_request':
        score += customer_demand_signals(intake)        # support ticket vote count
    return bucket(score, {80:'P0', 50:'P1', 20:'P2', 0:'P3'})
```

P0 → bypass quota, immediate. P1 → high-priority queue. P2/P3 → normal queue.

---

## 5. Per-type workflow detail

### 5.1 Problem workflow

```
[triaged]
   │ Diagnostician runs RCA — reads brain + recent metrics + relevant logs
   │ Outputs: 3 hypothesized causes ranked by likelihood
   ▼
[diagnosed] — L2 ETA emitted
   │ Architect generates 2-3 solution candidates: {scope, effort, risk, ETA, cost}
   ▼
[candidates_ready] ◀── Choose pattern (anh pick 1 of 2-3); Edit if anh tweaks
   ▼
[approved_solution]
   │ Engineer creates mission(s) + feature_key; sprint slot allocated
   ▼
[in_progress] ◀── Mission canvas live
   ▼
[review_ready] ◀── PR Gate Tier 1/2 pass → Confirm pattern (auto if Brier<0.10)
   ▼
[deployed]
   │ Acceptance checker: 3-day soak với synthetic probe
   ▼
[accepted] ◀── Optional Confirm "vấn đề đã giải quyết?"
   ▼
[closed]
```

Gates: 1 Choose + 1 Confirm + optional Confirm = **1-3 gates total**.

### 5.2 Feature request workflow

```
[triaged]
   │ PM: spec refinement (user story → acceptance criteria)
   ▼
[spec_drafted] ◀── Edit (tweak spec) HOẶC Confirm (high autonomy)
   │ ROI estimator runs
   ▼
[roi_estimated] — L2 ETA emitted
   │ Sprint slot allocated theo priority
   ▼
[scheduled] → [in_progress] → [review_ready] ◀── Confirm
   ▼
[deployed] → [accepted]
```

Gates: 1 Edit/Confirm (spec) + 1 Confirm (deploy) = **2 gates**.

### 5.3 Bug report workflow

```
[triaged] → QA repro confirmation
   ▼
[repro_confirmed]
   │ if priority=P0 → engineer immediate, hotfix worktree (Git-Branch-Tag §7)
   │ else → standard sprint
   ▼
[fixing] → [fixed] ◀── Confirm pattern (regression test pass)
   │ Hotfix release if P0/P1, else Train pickup
   ▼
[released] → [verified] ◀── auto if regression test pass + Brier<0.10
   ▼
[closed]
```

P0 với high autonomy + clean Brier → **0 gates**. Else 1 Confirm.

### 5.4 Feedback workflows (3 sub-types)

**General**: `[triaged] → [classified] (sentiment + theme) → [clustered] → [in_digest]`

Passive — chỉ xem trong weekly digest. Cluster size ≥ 5 → auto-promote thành `problem` hoặc `feature_request` intake. Emit `feedback_promoted_to_intake` event.

**Release feedback**: `[triaged] → [tied_to_release_tag] → [impact_measured] → [recommendation]`

Recommendation = `keep` / `tweak` / `rollback`. Rollback → **Decide** pattern (critical, irreversible-ish).

**Feature feedback**: `[triaged] → [tied_to_feature_key] → [aggregated_per_user] → [feature_health_updated]`

Health card update có thể trigger: `tweak` (Confirm) hoặc `sunset` (Decide).

### 5.5 Strategic input workflow

```
[triaged] → PM Strategic: scope analysis (which brain fields affected)
   ▼
[brain_diff_proposed]
   │ Internal Auditor: roadmap impact (which existing missions invalidated)
   ▼
[impact_assessed] ◀── Decide pattern (anh confirm pivot)
   ▼
[brain_updated] → Strategic Loop next run consumes new brain
   ▼
[propagated]
```

Gate: 1 Decide. Always human-required (high blast radius).

### 5.6 Question workflow

```
[triaged] → KB search agent: RAG query workspace docs + global principles
   ▼
[answered] — auto-emit answer in chat panel; anh thumbs-up/down
```

No gate (passive). Thumbs-down → escalate to architect agent for deeper answer + create `feedback_general` intake.

---

## 6. Timeline estimation 3-level

### 6.1 Level definitions

| Level | When emitted | Method | Accuracy |
|---|---|---|---|
| **L1** | Post-triage (< 5 min) | Class-based bracket lookup | ±50% |
| **L2** | Post-spec/diagnose | Velocity history × complexity + Monte Carlo (1000 samples) | ±25% |
| **L3** | In-progress | Live: actual progress + remaining work + drag-in adjustment | ±10% |

### 6.2 L1 brackets (days)

```python
L1_BRACKETS = {
    ('problem',         'P0'): (1, 3),
    ('problem',         'P1'): (3, 7),
    ('problem',         'P2'): (5, 14),
    ('feature_request', 'P0'): (3, 10),
    ('feature_request', 'P1'): (5, 15),
    ('feature_request', 'P2'): (10, 30),
    ('bug_report',      'P0'): (0.5, 2),
    ('bug_report',      'P1'): (1, 5),
    ('bug_report',      'P2'): (3, 10),
    ('strategic_input', '*'):  (1, 3),
    ('feedback_*',      '*'):  None,        # passive, no ETA
    ('question',        '*'):  (0.01, 0.1), # < 5 min
}
```

### 6.3 L2 formula

```python
def estimate_l2(intake, spec):
    base_complexity = score_complexity(spec)            # S=1d, M=3d, L=8d, XL=20d
    velocity = workspace.velocity_per_role[primary_role]
    autonomy_drag = drag_factor(workspace.autonomy_level)
    samples = []
    for _ in range(1000):
        days  = sample_lognormal(base_complexity, velocity, autonomy_drag)
        days += sample_dependency_delays(intake.dependencies)
        samples.append(days)
    return {'p50': pct(samples,50), 'p90': pct(samples,90)}
```

### 6.4 L3 live update

- Mỗi mission state transition → recompute remaining work
- Drag-in event (Self-Healing Rule 7) → push ETA bằng cộng thêm est. drag-in time
- Approval pending > 24h → **pause clock** (clock stops while waiting human)
- ETA delta > 50% từ last L2 → notify anh + offer "still want to proceed?" Decide

---

## 7. Progress tracking UX

### 7.1 Intake List view

```
┌──── Intake List ──────────────────────────────────────────┐
│ Filter: [Type ▾] [Status ▾] [Workspace ▾] [Submitter ▾]  │
├───────────────────────────────────────────────────────────┤
│ 🔴 Problem · FitTracker · in_progress                     │
│   "Onboarding drop 40%"                                   │
│   ETA: 4-6d (L2) · 2 gates pending                        │
├───────────────────────────────────────────────────────────┤
│ 🐞 Bug · AdminTool · review_ready                         │
│   "Login broken iOS 17.2"                                 │
│   ETA: closing today                                      │
├───────────────────────────────────────────────────────────┤
│ 🟢 Feature · FitTracker · scheduled                       │
│   "Export PDF dashboard"                                  │
│   Sprint slot: Sprint 14 · ETA: 8d (L2)                   │
└───────────────────────────────────────────────────────────┘
```

### 7.2 Intake Detail page

```
┌── Intake #1247: Onboarding drop 40% ─────────────────────┐
│ Status: in_progress · Type: problem · Priority: P1       │
│ Submitter: anh · Created: 2d ago                         │
│                                                           │
│ ── Timeline ribbon ──                                     │
│ triaged (2d) → diagnosed (1d) → approved (4h) → ▶ impl   │
│                                                           │
│ ── ETA ──                                                 │
│ L2: 4-6d remaining (P50 4.2d, P90 5.8d)                  │
│ Last update: 30min ago                                    │
│                                                           │
│ ── Mission canvas ──                                      │
│ → mission #M-883 (Engineer) · 60% done                    │
│ → mission #M-884 (QA) · waiting                           │
│                                                           │
│ ── Pending approvals ──                                   │
│ • Confirm: deploy fix to prod (Tier 2 PR Gate passed)     │
│ • Confirm: acceptance after 3-day soak (in 2d)            │
│                                                           │
│ ── Activity feed (live) ──                                │
│ 30min ago · Engineer pushed PR #4421                      │
│ 1h ago · QA wrote regression test (3 cases)               │
│ 2h ago · Diagnosed: cause = 3rd-party SDK timeout         │
│                                                           │
│ [Subscribe] [Add comment] [Close intake]                  │
└───────────────────────────────────────────────────────────┘
```

### 7.3 Mobile per-intake

- Vertical timeline ribbon
- "Approval pending" pinned to top
- Push notification mỗi state transition (theo autonomy notification matrix UX §7.3)

---

## 8. Approval pattern mapping

| Intake type | Stage | Default pattern (`medium` autonomy) |
|---|---|---|
| `problem` | candidates_ready | **Choose** (1 of 2-3) |
| `problem` | review_ready | Confirm |
| `problem` | accepted | Confirm (optional) |
| `feature_request` | spec_drafted | Edit (or Confirm if conf>0.85) |
| `feature_request` | review_ready | Confirm |
| `bug_report` (P0, Brier<0.10) | fixed | **auto** (no gate) |
| `bug_report` (P1+) | fixed | Confirm |
| `feedback_release` | rollback recommended | **Decide** |
| `feedback_feature` | sunset proposed | **Decide** |
| `strategic_input` | impact_assessed | **Decide** |
| `question` | answered | thumbs-up/down (passive) |

→ Tất cả mappings respect per-workspace autonomy level qua [[Decision-Boundary-and-Uncertainty-Model]] §3.4 thresholds.

---

## 9. Feedback aggregation

### 9.1 Cluster pipeline (cron 30-min)

```python
def cluster_feedback():
    open_feedbacks = query("type LIKE 'feedback_%' AND state IN ('triaged','classified')")
    embeddings = [embed(fb.text) for fb in open_feedbacks]
    clusters = DBSCAN(eps=0.25, min_samples=3).fit(embeddings)
    for cluster_id, members in groupby(clusters):
        if len(members) >= 5 and within_14d(members):
            promote_cluster_to_intake(cluster_id, type=infer_type(members))
```

### 9.2 Promotion rule

- ≥ 5 feedbacks within 14d trong cùng cluster → auto-promote thành `problem` hoặc `feature_request` intake
- Promoted intake links back to source feedbacks (audit chain qua `feedback_clusters.member_intake_ids`)
- Notify submitters của source feedback khi cluster promoted intake closed

### 9.3 Sentiment tracking

```sql
CREATE TABLE feedback_sentiment (
  feedback_id     UUID PRIMARY KEY REFERENCES intake_items(id),
  sentiment       NUMERIC,                 -- -1 to 1
  emotions        TEXT[],                  -- ['frustrated','confused',...]
  classifier_model TEXT
);
```

Weekly digest: top 5 negative-sentiment clusters per workspace → potential intake promotion candidates.

---

## 10. Integration với existing flows — chi tiết

### 10.1 Inbound trigger map (intake event → existing flow phản ứng)

| intake event | Triggers (downstream) |
|---|---|
| `intake.created` | (1) Strategic Loop signal collector adds to `signals` queue (source=`human_intake`); (2) Decision-Boundary computes initial uncertainty; (3) Cost forecast bumps workspace projection (Paperclip-Platform §11.1); (4) Self-Healing increments `intake_count` for drag-in detection (Rule 7); (5) Triage agent kicks off |
| `intake.triaged` | (1) Approval Center pending item if pattern needs gate; (2) UX push (per autonomy notification matrix); (3) L1 ETA published |
| `intake.candidates_ready` | (1) Choose pattern approval item; (2) Cost+risk per candidate; (3) ETA per candidate |
| `intake.approved` | (1) Mission(s) created in workspace; (2) `feature_key` assigned (for Train); (3) Sprint slot allocated; (4) Strategic Loop incorporates into current/next sprint plan |
| `intake.rejected` | (1) Rejection-Learning ingests (extends 14-cat to 16-cat); (2) Brain update if rejection reveals pattern; (3) Similar intakes flagged for review |
| `intake.completed` | (1) Acceptance soak (3d cho `problem`, none nếu `bug_report` already verified); (2) Outcome tracker T+7 (Strategic §10); (3) Submitter feedback prompt; (4) Auto-close |
| `feedback_cluster.size>=5` | Auto-promote to `problem`/`feature_request` intake; emit `feedback_promoted_to_intake` |
| `intake.duplicate_detected` | Merge proposal Confirm pattern |
| `intake.eta_delta>50%` | Notify submitter + Decide "still proceed?" if scope changed |

### 10.2 Outbound feed map (existing flow → tạo intake tự động)

| Source | Auto-creates intake type | Trigger condition |
|---|---|---|
| Sentry critical alert | `bug_report` | severity=fatal AND affected_users>0 |
| Support ticket MCP | `feedback_general` | new ticket arrived AND classify_conf > 0.6 |
| Rejection cluster (Rejection §4) | `problem` "we keep failing" | DBSCAN cluster size > 10 |
| Cohort canary breach | `feedback_release` | canary_metric < threshold |
| KB doc staleness > 90d (critical doc) | `problem` "doc rot" | Knowledge-Base §4 staleness |
| Cross-workspace pattern (Cross-Repo §3 meta-rejection) | `strategic_input` | 3+ workspaces hit same issue |
| Brain conflict (Decision-Boundary §6) | `strategic_input` | brain inconsistency detected |
| Self-Healing Rule 7 drag-in > 2× quota | `strategic_input` "autonomy regression" | Self-Healing emits |
| Production synthetic probe fail | `bug_report` P0 | probe_fail_rate > threshold |

### 10.3 Per-doc integration table — cần wire khi implement

| Doc | Section | Integration | Edit type | Priority |
|---|---|---|---|---|
| Strategic Loop | §3 Signal collector | Add `human_intake` source enum + reader | Code + doc | **P0** |
| Strategic Loop | §4.4 planSprintNode | Mid-sprint preemption logic for P0/P1 intake | Code + doc | P1 |
| Decision-Boundary | §3 Uncertainty composite | Add `intake_type_uncertainty_weight` factor | Code + doc | P1 |
| Autonomy-Dial | §6 Pattern catalog | Extend với intake type/stage → pattern map | Doc + DB seed | **P0** |
| Autonomy-Dial | §7 Gate quota | Intake-induced gates count toward quota | Code | P1 |
| Self-Healing | Rule 7 Drag-in | Add intake-volume rule (intake_per_week > 2× quota) | **Doc edit** | **P0** |
| UX-Strategy | §3.1 Navigation | Add `📥 Intake` top-level + per-workspace `+ Intake` button | **Doc edit** | **P0** |
| UX-Strategy | §6 Notification hierarchy | Intake state transitions per autonomy matrix | Doc | P1 |
| Approval Center | Filter | Add `intake_id` filter + cross-link from intake | Code | P1 |
| Greenfield | §1 | Differentiate "intake = in-flight" vs "greenfield = NEW" | **Doc edit** | **P0** |
| Knowledge-Base | §3 | Question-type intake feeds KB query log | Code | P2 |
| Rejection-Learning | §3 Taxonomy | Add 2 categories: `intake_abandoned`, `intake_solution_rejected` | Doc + schema | P1 |
| Cross-Repo | §1 Saga | Multi-repo intake → trigger Saga (feature_key threading) | Code | P2 |
| Git-Branch-Tag | §7 Hotfix | Bug intake P0 → hotfix worktree workflow | Code | P1 |
| Testing | §11 | Feature intake → require persona-driven scenarios | Code (PR Gate) | P2 |
| Magika | §6 | Intake mentions specific files → triage affected | Code | P2 |
| External-Integrations | §4 MCP | Email intake parser (intake@<workspace>.paperclip MX) + Canny webhook | Code | P1 |
| Paperclip-Platform | §11.1 Cost forecast | Each intake bumps workspace forecast per type/priority | Code | P1 |
| Cross-Repo | §2 Brier | Per-intake outcome tracked → calibration | Code | P1 |
| Full-System | §2.1 Trigger inventory | Add 3 intake triggers | **Doc edit** | **P0** |

= 20 docs touched. **6 P0 doc-edits applied immediately** (xem §10.4); 14 còn lại defer đến sprint code-impl.

### 10.4 Doc edits applied now (P0 — immediate visibility)

1. **Strategic Loop §3** — extend signal source list with `human_intake`
2. **Self-Healing §3 Rule 7** — add intake-volume trigger
3. **UX-Strategy §3.1** — add Intake nav tab
4. **Greenfield §1** — clarify scope boundary (NEW vs in-flight)
5. **Full-System §2** — add 3 intake triggers to inventory
6. **Autonomy-Dial §6** — note pattern catalog extended (link to §8 above)

### 10.5 Conflict resolution

| Scenario | Conflict | Resolution |
|---|---|---|
| Intake P0 mid-sprint | Existing missions in progress | Strategic Loop preemption: pause non-critical missions for P0; if quota hits hard cap → Decide pattern |
| 2 intakes propose contradictory solutions | A says X, B says ¬X | Internal Auditor flags → Decide (anh picks) |
| Intake conflicts with brain | Strategic input contradicts existing brain | Brain update workflow (§5.5); contradicts global principle → Decide critical |
| Intake duplicates existing mission | Sim > 0.85 với active mission | Auto-merge or "this work is already in progress, subscribe?" Confirm |
| Intake exhausts gate quota | Quota full | Batch overflow into single Confirm "approve all 5 intake gates?" |
| Workspace `frozen` | Intake to inactive workspace | Reject với option "unfreeze workspace?" Confirm |
| Brain drift mid-intake | Brain updated by another intake during in-progress | Mission revalidation; if invalidated → notify submitter Decide |

### 10.6 Idempotency + replay

- **Intake creation**: dedup window 5 min (same submitter + sim > 0.95 → reject as duplicate)
- **State transitions**: each emits idempotent event (`event_id = intake_id::state::version`); replay-safe
- **ETA recompute**: cron pulls stale (`last_eta_update > 1h`) → recompute incrementally
- **Cancellation**: anh `[Close intake]` at any state → spawn `intake_cancelled` event → kill associated missions với checkpoint snapshot

---

## 11. Schema

```sql
CREATE TABLE intake_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           TEXT NOT NULL,
  type                   TEXT NOT NULL,              -- problem/feature_request/bug_report/feedback_*/strategic_input/question
  priority               TEXT,                       -- P0/P1/P2/P3
  state                  TEXT NOT NULL,              -- triaged/diagnosed/.../accepted/closed
  submitter              TEXT NOT NULL,
  submitter_mood         INT,                        -- 1-5
  raw_text               TEXT NOT NULL,
  attachments            JSONB,
  classified_type_conf   NUMERIC,
  linked_release_tag     TEXT,
  linked_feature_key     TEXT,
  duplicate_of           UUID REFERENCES intake_items(id),
  source                 TEXT,                       -- human_console / auto_promoted / api / email / mobile
  source_ref             TEXT,                       -- if auto: alert_id / cluster_id / etc.
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now(),
  closed_at              TIMESTAMPTZ
);

CREATE TABLE intake_workflow_states (
  intake_id    UUID REFERENCES intake_items(id),
  state        TEXT,
  entered_at   TIMESTAMPTZ DEFAULT now(),
  duration_min NUMERIC,
  agent        TEXT,
  PRIMARY KEY (intake_id, state)
);

CREATE TABLE intake_solutions (
  intake_id     UUID REFERENCES intake_items(id),
  candidate_idx INT,
  scope         JSONB,
  effort_days   NUMERIC,
  risk_score    NUMERIC,
  eta_p50_days  NUMERIC,
  eta_p90_days  NUMERIC,
  cost_usd      NUMERIC,
  selected      BOOL DEFAULT false,
  PRIMARY KEY (intake_id, candidate_idx)
);

CREATE TABLE intake_timeline_estimates (
  intake_id    UUID REFERENCES intake_items(id),
  level        TEXT,                                 -- L1/L2/L3
  p50_days     NUMERIC,
  p90_days     NUMERIC,
  computed_at  TIMESTAMPTZ DEFAULT now(),
  source       TEXT
);

CREATE TABLE feedback_clusters (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_size           INT,
  centroid_emb           VECTOR(1536),
  theme                  TEXT,
  member_intake_ids      UUID[],
  promoted_to_intake_id  UUID REFERENCES intake_items(id),
  created_at             TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE intake_outcome_tracker (
  intake_id          UUID REFERENCES intake_items(id) PRIMARY KEY,
  predicted_eta_p50  NUMERIC,
  actual_days        NUMERIC,
  predicted_cost     NUMERIC,
  actual_cost        NUMERIC,
  acceptance_status  TEXT,                           -- accepted/rejected/silent
  measured_at        TIMESTAMPTZ
);

CREATE INDEX idx_intake_workspace_state ON intake_items(workspace_id, state) WHERE closed_at IS NULL;
CREATE INDEX idx_intake_submitter ON intake_items(submitter, created_at DESC);
```

---

## 12. Cron jobs

| Cron | Frequency | Purpose |
|---|---|---|
| Intake triage backlog sweep | every 5 min | Process triaged → diagnose for stale > 5min |
| ETA recompute (stale) | every 1h | Recompute L3 for in-progress intakes |
| Feedback clustering | every 30 min | DBSCAN cluster open feedbacks |
| Cluster promotion check | hourly | Promote clusters ≥ 5 members |
| Intake outcome tracker | daily, T+7 | Compare predicted vs actual eta/cost |
| Intake age alert | daily | Flag intakes > 30d in non-terminal state |
| Acceptance soak ticker | hourly | Move 3-day-old `deployed` to `accepted` if no regression |
| Duplicate sweep | every 6h | Re-check open intakes against newly arrived for late dedup |

---

## 13. Risk mitigation

| Risk | Mitigation |
|---|---|
| Intake spam (bot/abuse) | Rate limit per submitter (10/day default) + sentiment auto-close cho nonsense |
| Auto-classify mistakes | Confidence < 0.7 → Choose pattern; record actual type for classifier retraining |
| Intake ages forever | Daily "stale intake" cron → escalate to digest after 30d |
| Submitter expects instant magic | L1 ETA always shown immediately; expectation set realistic |
| Feedback cluster false-positive promotion | Promotion needs unanimous semantic agreement (cosine ≥ 0.85 within cluster) |
| Cost runaway from over-eager P0 | Priority scorer Brier-calibrated; weekly review of P0 frequency |
| Intake exhausts gate quota | Intake gates respect Autonomy-Dial quota; overflow → batch single Confirm |
| Submitter and product owner mismatch | RBAC bypass for single-owner Paperclip; later add tenant-of-Paperclip if multi-user |

---

## 14. Cross-doc liên kết

Spine:
- [[Autonomous-PM-Strategic-Loop-Design]] §3 — Signal collector source extension
- [[Autonomy-Dial-and-Progressive-Trust-Design]] §6 — Pattern mapping per intake type
- [[UX-Strategy-and-Design]] §3 — Intake nav + console UX
- [[Decision-Boundary-and-Uncertainty-Model]] §3 — Uncertainty contribution per intake type

Adjacent:
- [[Self-Healing-and-Liveness-Design]] Rule 7 — Drag-in signal includes intake volume
- [[Greenfield-Bootstrap-Design]] §1 — Scope boundary (NEW vs in-flight)
- [[Knowledge-Base-Management-Strategy]] §3 — Question-type intake → KB
- [[Rejection-Learning-and-Feedback-Loop]] §3 — Extended taxonomy 14→16-cat
- [[Full-System-Workflow-and-Coordination]] §2 — Trigger inventory extended
- [[Paperclip-Platform-Workspace-Mission-Model]] §11.1 — Cost forecast bumps from open intake

---

## 15. Score impact

Goal "human = gate, rest = automated" pre-Intake-Hub: 9.2/10.

| Sub-axis | Pre-Intake | Post-Intake |
|---|---|---|
| Human entry surface | 4/10 (chỉ Greenfield + Approval Center) | **9/10** (7 types, 5 surfaces) |
| Auto-classification | 0/10 | **8/10** (classifier confidence-aware) |
| Timeline visibility | 5/10 (per-mission, no intake-level) | **9/10** (3-level ETA) |
| Feedback aggregation | 0/10 | **8/10** (DBSCAN cluster + auto-promote) |
| End-to-end follow-through | 5/10 | **9/10** (intake → accept) |

**Overall: 9.2/10 → 9.5/10.**

---

## 16. North star

| Metric | Target Phase 1 (3 mo) | Target Phase 2 (6 mo) |
|---|---|---|
| Time intake → first L2 ETA | < 2h P50 | < 30 min P50 |
| Time intake → first solution candidate | < 24h P50 | < 4h P50 |
| Intake closure rate within 30d | > 70% | > 90% |
| Auto-classify accuracy | > 80% | > 95% |
| Intake → mission link rate | > 95% | 100% |
| Submitter satisfaction (post-acceptance) | > 4.0/5 | > 4.5/5 |
| % intake auto-resolved (Confirm-only, no Choose/Edit/Decide) | > 60% | > 80% |

---

## 17. Implementation roadmap

| Sprint | Effort | Deliverable |
|---|---|---|
| Sprint 1 | 4d | `intake_items` schema + console entry point + triage agent |
| Sprint 2 | 5d | 3 workflow types implemented (problem, feature_request, bug_report) |
| Sprint 3 | 3d | Timeline 3-level estimation + intake list/detail UI |
| Sprint 4 | 3d | Approval pattern wiring + Strategic Loop integration |
| Sprint 5 | 3d | Feedback aggregation + clustering + auto-promote |
| Sprint 6 | 3d | Mobile capture + email parser + question/strategic_input |
| Sprint 7 | 2d | Outcome tracker + acceptance soak + cron jobs |
| Sprint 8 | 2d | Cross-doc integration polish (14 deferred edits) + RBAC bypass single-owner |

**Total: ~25 days** (4 weeks). Rec: bundle vào roadmap chính ([[Paperclip-Platform-Workspace-Mission-Model]] §18) sau Sprint 4 (basic platform ready).
