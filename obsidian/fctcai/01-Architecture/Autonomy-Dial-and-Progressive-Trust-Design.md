---
tags: [architecture, autonomy, trust, gate, automation, foundational]
date: 2026-04-29
type: foundational-policy
related:
  - 00-Master-Architecture-Overview
  - Paperclip-Platform-Workspace-Mission-Model
  - Autonomous-Operations-and-Human-Gate-Design
  - Decision-Boundary-and-Uncertainty-Model
  - Cross-Repo-Coordination-and-Decision-Hardening
status: design
---

# Autonomy Dial & Progressive Trust Design

> ⚠️ **MISSION-CRITICAL DOC.** Doc này định nghĩa cách Paperclip thực sự đạt mục tiêu "**human = gate approve, mọi thứ khác automated**". Trước doc này, các doc khác accumulate gate mà không có policy auto-resolve → kết quả gate count vượt quota, anh sẽ overload. Doc này là **policy layer** áp lên mọi gate.

## 1. Mục tiêu lượng hóa

### 1.1 North star (định lượng)

| Metric | Target Phase 1 (1-5 projects) | Target Phase 2 (5-15 projects) | Target Phase 3 (15-30 projects) |
|---|---|---|---|
| Gate / project / week | ≤ 8 | ≤ 5 | ≤ 3 |
| Human time / project / week | ≤ 60 min | ≤ 40 min | ≤ 25 min |
| Auto-resolve rate | ≥ 70% | ≥ 85% | ≥ 92% |
| Drag-in events / project / week | ≤ 2 | ≤ 1 | 0 |
| Median gate decision time | ≤ 5 min | ≤ 2 min | ≤ 1 min |

**Drag-in event = anh bị kéo vào ngoài Approval Center** (debug session, manual fix, ad-hoc question). Đây là metric quan trọng nhất — đo "automation thật hay automation giả".

### 1.2 Gate definition (chính xác)

Gate **chỉ là gate** nếu:
- Có **hard requirement** human decide (vd legal, irreversible, blast radius cao).
- Hoặc **agent confidence < threshold** AND không có pattern reuse.

Gate **KHÔNG nên là gate** nếu:
- Có precedent: 20 lần liên tiếp human approve không edit.
- Risk reversible + low blast radius.
- Agent có confidence > calibrated threshold.

→ Mọi capability ban đầu là gate; **progressive trust** auto-promote sang non-gate khi đủ evidence.

---

## 2. Autonomy Dial per Workspace

### 2.1 Bốn level

| Level | Auto target % | Gate count target | Use case |
|---|---|---|---|
| `sandbox` | 99% | ≤ 1/week | Throwaway / experimentation |
| `high` | 95% | ≤ 3/week | Mature workspace, proven trust |
| `medium` | 85% | ≤ 8/week | Default cho new workspace |
| `low` | 70% | ≤ 15/week | Regulated / compliance-critical |

### 2.2 Tác dụng của level

Mỗi level set:
1. **Default capability mode** — sandbox flips most to auto; low keeps gate.
2. **Promotion threshold** — sandbox: N=3 consecutive successes → auto. High: N=10. Medium: N=20. Low: N=50.
3. **Confidence threshold** — sandbox: 0.6. High: 0.7. Medium: 0.8. Low: 0.9.
4. **Notification policy** — sandbox: digest only. High: digest + critical interrupt. Medium: hourly batch. Low: real-time.
5. **Gate quota hard ceiling** — vượt → auditor flag, force calibration review.

### 2.3 Workspace lifecycle binding

| Workspace state | Mặc định autonomy |
|---|---|
| `intake` | low (high-stakes design decisions) |
| `active` (mới tạo, < 4 weeks) | medium |
| `active` (mature, > 4 weeks success) | auto-graduate to `high` (xem §4) |
| `paused` | giữ nguyên |
| `frozen` | n/a |
| `archived` | low (chỉ critical decisions) |

### 2.4 Manual override

Anh có thể set autonomy explicitly:
```yaml
workspace: quanlychungcu
autonomy_level: high   # override default
override_reason: "production matured 6 months, trust EngineerAgent"
override_set_at: 2026-04-29
```

Stored in `workspaces.autonomy_profile` (JSONB).

---

## 3. Capability Default Mode — Revisit

### 3.1 Current problem

Nhiều capability default = "gate" để "an toàn". Kết quả: gate explosion.

### 3.2 New default matrix

| Capability | Risk | Reversibility | Default mode |
|---|---|---|---|
| `engineer.write_code` | low | high | **auto** |
| `engineer.commit_to_branch` | low | high | **auto** |
| `engineer.commit_to_main` | medium | high (revert) | **auto-with-trust** (§4) |
| `engineer.delete_file` | medium | high (git revert) | auto |
| `engineer.run_migration_dev` | medium | medium | auto |
| `engineer.run_migration_stag` | medium | medium | auto-with-trust |
| `engineer.run_migration_live` | high | low | **gate (always)** |
| `qa.run_test_dev` | low | high | auto |
| `qa.run_test_prod` | low | high | auto |
| `devops.deploy_dev` | low | high | auto |
| `devops.deploy_stag` | medium | high (rollback) | auto |
| `devops.deploy_live` | high | medium | **gate (default)** → can downgrade if Train Brier high |
| `devops.canary_advance` | medium | high | auto |
| `devops.auto_rollback` | medium | high | auto |
| `devops.delete_resource_dev` | low | high | auto |
| `devops.delete_resource_live` | critical | low | gate (always, security floor) |
| `pm.approve_sprint` | low | high | **auto-with-trust** (was gate) |
| `pm.approve_feature_kickoff` | low | high | **auto-with-trust** (was gate) |
| `design.approve_visual` | low | high | **auto-with-trust** (was gate) |
| `design.merge_design_system` | medium | medium | auto-with-trust |
| `support.respond_ticket` | low | high | auto |
| `support.refund_customer` | medium | low | gate |
| `security.allow_dependency` | medium | medium | gate |
| `security.exempt_scan` | high | low | gate (always) |
| DSR erase | high | low | gate (legal floor) |

### 3.3 "auto-with-trust" semantic

= **auto IF** progressive trust counter (§4) ≥ workspace's promotion threshold; **gate** otherwise.

Workspace mới: counter 0 → vẫn gate. Sau 20 successful gates passes (no edit, no rollback within 24h), auto-promote → mode 'auto'. Future invocations skip gate.

### 3.4 Demotion (auto → gate trở lại)

Trigger:
- 1 incident ngược (rollback within 24h, customer ticket linked) → demote, reset counter.
- 3 consecutive minor edits during gate review → demote.
- Capability skill version updated → reset counter (canary mode).

---

## 4. Progressive Trust Algorithm

### 4.1 Trust counter

Mỗi (workspace_id, capability_id) pair có:
```sql
CREATE TABLE capability_trust_counters (
  workspace_id TEXT,
  capability_id TEXT,
  consecutive_success INT DEFAULT 0,
  last_success_at TIMESTAMPTZ,
  total_invocations INT DEFAULT 0,
  total_successes INT DEFAULT 0,
  total_failures INT DEFAULT 0,
  current_mode TEXT,                    -- 'gate' / 'auto'
  promoted_at TIMESTAMPTZ,
  demoted_at TIMESTAMPTZ,
  promotion_count INT DEFAULT 0,        -- bao nhiêu lần promote (lifetime)
  demotion_count INT DEFAULT 0,
  PRIMARY KEY (workspace_id, capability_id)
);
```

### 4.2 Promotion trigger

```python
def maybe_promote(workspace, capability):
    counter = get_counter(workspace.id, capability.id)
    threshold = workspace.autonomy_profile.promotion_threshold[capability.risk]
    
    if counter.consecutive_success >= threshold:
        if confidence_calibrated(workspace, capability):
            promote(workspace, capability)
            log_decision(
                workspace=workspace,
                capability=capability,
                from_mode='gate', to_mode='auto',
                evidence={'consecutive_success': counter.consecutive_success},
            )
            notify_user(f"Capability {capability.id} auto-promoted in {workspace.id} after {counter.consecutive_success} successful gates.")
```

### 4.3 Calibration check

Brier calibration (Cross-Repo §2) tracks per-(agent, workspace) confidence accuracy. Promotion blocks if calibration off:

```python
def confidence_calibrated(workspace, capability):
    brier = get_brier_score(workspace, capability.agent_role)
    return brier < 0.15   # well-calibrated threshold
```

### 4.4 Demotion trigger

```python
def maybe_demote(workspace, capability, outcome):
    counter = get_counter(workspace.id, capability.id)
    
    if outcome.is_failure or outcome.was_rolled_back_within_24h:
        counter.consecutive_success = 0
        if counter.demotion_count + 1 >= 3 and workspace.autonomy_level != 'low':
            # 3 demotions → reset workspace to lower autonomy
            warn_user("Workspace {workspace.id} has frequent demotions, consider lowering autonomy.")
        demote(workspace, capability)
        emit_audit_event(...)
```

### 4.5 Threshold matrix per autonomy level × capability risk

| Autonomy level | low risk | medium risk | high risk | critical |
|---|---|---|---|---|
| sandbox | 3 | 5 | 10 | never auto |
| high | 5 | 10 | 30 | never auto |
| medium | 10 | 20 | 50 | never auto |
| low | 30 | 50 | 100 | never auto |

→ Critical capability **không bao giờ auto** (hard floor — DSR erase, security exempt, deploy live in 'low' workspace).

### 4.6 Cross-workspace trust transfer

Khi tạo workspace mới: import trust counter từ "donor" workspace có pattern tương tự?
- **NO by default** — fresh start, vì context khác.
- **Exception**: workspace clone (§Workspace lifecycle clone) — copy counter từ source.

---

## 5. Confidence-Driven Gating

### 5.1 Mọi action emit confidence

Agent khi propose action emit:
```python
ProposedAction = {
    'capability_id': 'engineer.commit_to_main',
    'reasoning_summary': 'Refactored extractMethod, all tests pass, no breaking changes',
    'confidence': 0.92,                         # 0-1
    'confidence_factors': {
        'test_pass_rate': 1.0,
        'similar_pattern_count': 8,
        'codebase_familiarity': 0.85,
        'change_size_lines': 47,
    },
    'risk_factors': {
        'touches_critical_path': False,
        'modifies_public_api': False,
    },
    'fallback_plan': 'git revert HEAD if regression detected within 24h',
}
```

### 5.2 Decision routing

```python
def route_action(workspace, action):
    capability = get_capability(action.capability_id)
    threshold = workspace.autonomy_profile.confidence_thresholds[capability.risk]
    
    # Hard floor first
    if capability.is_security_floor:
        return 'gate'
    
    # Confidence + trust gating
    counter = get_counter(workspace.id, capability.id)
    
    if counter.current_mode == 'auto':
        if action.confidence >= threshold:
            return 'auto'
        else:
            return 'gate'   # auto mode but low confidence → still gate
    
    # current_mode = 'gate'
    # Even if gate, attach proposal for fast human approval
    return 'gate-with-proposal'
```

### 5.3 Brier calibration loop

Nightly cron compute per-(workspace, agent_role, capability) Brier score:
```python
brier = mean((confidence - actual_outcome)**2 for each historical action)
# actual_outcome = 1 if success, 0 if failure/rollback
```

Adjust effective confidence threshold per workspace:
- Brier < 0.05 → trust agent fully, lower threshold cho auto.
- Brier > 0.20 → distrust, raise threshold (effectively more gate).

```python
adjusted_threshold = base_threshold + (brier - 0.10) * 2
```

→ Self-tuning. Workspace nào agent giỏi → ít gate.

---

## 6. Auto-Propose Pattern Catalog

### 6.1 Nguyên tắc

**Mọi gate PHẢI đi kèm proposal cụ thể từ agent.** Human chỉ confirm/edit/reject — không "decide from scratch".

→ Đây là khác biệt giữa "5 phút thinking" và "10 giây click".

### 6.2 Pattern: 4 loại approval UI

| Pattern | UI | Agent prep | Human action | Time |
|---|---|---|---|---|
| **Confirm** | "Agent proposes X. Confirm?" | Full proposal + reasoning | Click Yes | < 30s |
| **Choose** | "Agent proposes A or B. Choose:" | 2-3 ranked options | Click 1 | < 1m |
| **Edit** | "Agent proposes X. Review/edit:" | Proposal as editable form | Tweak + Submit | 2-3m |
| **Decide** | "Need decision on X. Context: ..." | Context only | Free-form | 5-15m |

→ **Target: 80% gate là Confirm/Choose, 15% Edit, 5% Decide.**

Hiện tại design có quá nhiều "Decide" — cần refactor về Confirm/Choose.

> **Catalog extended cho Human Intake** — xem [[Human-Intake-and-Solution-Loop-Design]] §8 cho per-(intake_type × stage) → pattern map. Tóm tắt:
> - `bug_report` (well-defined) → mostly **Confirm** (root cause + fix proposal); P0 hot bugs auto-fix nếu trust counter cao
> - `feature_request` → **Choose** (2-3 candidate solutions ranked by impact/effort/risk)
> - `problem` (open-ended) → **Edit** (agent đề xuất framing + scope, human tweaks)
> - `strategic_input` → **Decide** (brain conflict, multi-workspace impact)
> - `feedback_*` → triage tự động, không gate trừ khi feedback chỉ ra hard incident
> - `question` → tự trả lời từ KB; gate chỉ khi confidence < 0.7

### 6.3 Refactor mọi gate hiện tại

| Gate | Hiện tại (Decide) | Refactor → |
|---|---|---|
| Greenfield approve personas | "Review 5 personas, edit/approve" | Confirm: "Top 3 personas auto-ranked by market fit. Confirm or pick alternative?" |
| Greenfield top stories | "Pick top 5 from 20" | Choose: "Agent ranked top 5 by impact/effort. Confirm or swap?" |
| Sprint plan | "Review sprint" | Confirm: "Sprint plan ready. Edit or confirm?" |
| Feature kickoff | "Approve to start" | Confirm: "Agent estimated $X cost / Y days. Approve?" |
| Migration approve | "Review migration SQL" | Confirm: "Migration analyzed: zero-downtime, reversible. Approve?" |
| Deploy live | "Approve deploy" | Confirm: "Train 2026.W17.r3 stag healthy 24h. Promote?" |
| Visual diff | "Review diff" | Choose: "AGENT thinks: design intent / regression / ambiguous (75/15/10%). Pick:" |
| UX heuristic < 7 | "Review UX issue" | Edit: "Agent identified Nielsen #5 violation. Suggested fix: [code]. Apply or modify?" |
| Manual TC review | "Review TC report" | Confirm: "TC pass per acceptance criteria. Confirm or flag?" |
| Conflict resolution | "Resolve conflict" | Edit: "Agent's merge proposal: [diff]. Apply or modify?" |
| DSR cert | "Review DSR" | Confirm: "DSR validated, Ed25519 signed. Confirm before sending to user?" |
| Auditor finding | "Review finding" | Choose: "Agent recommends: A) Adjust principle B) Train workspace C) Ignore. Pick:" |

→ Average gate time **5 min → 1 min**. 5x reduction.

### 6.4 Schema for proposals

```sql
ALTER TABLE approval_items ADD COLUMN proposal_pattern TEXT;  -- 'confirm' / 'choose' / 'edit' / 'decide'
ALTER TABLE approval_items ADD COLUMN proposal_payload JSONB;
-- For 'choose': { options: [...], recommended_index: 0 }
-- For 'confirm': { action: ..., reasoning: ..., fallback: ... }
-- For 'edit': { editable_fields: [...] }
-- For 'decide': { context: ..., questions: [...] }
```

### 6.5 Time-to-decide tracking

```sql
ALTER TABLE approval_items ADD COLUMN time_to_decision_seconds INT;
```

→ Aggregate: median per-pattern, per-workspace, per-capability. If "confirm" gates trung bình > 2 min → broken (proposals quá khó hiểu, refactor).

---

## 7. Gate Quota & Drag-In Tracker

### 7.1 Gate quota — hard ceiling

Per workspace, week:
```python
max_gates_per_week = autonomy_profile.gate_quota[autonomy_level]
# sandbox: 1, high: 3, medium: 8, low: 15
```

Vượt:
- Soft warning anh: "Workspace X had 12 gates this week (target 8)".
- Cron auditor weekly: identify capabilities sinh gate nhiều nhất → recommend lower threshold or auto-promote.
- 2 tuần liên tiếp breach → force review session, auditor proposes calibration.

### 7.2 Drag-in tracker

```sql
CREATE TABLE human_drag_in_events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT,
  trigger_kind TEXT,                    -- 'debug_session' / 'manual_fix' / 'ad_hoc_question' / 'unscheduled_review'
  triggered_by TEXT,                    -- 'agent_failed' / 'self_initiated' / 'ops_alert_unhandled'
  duration_minutes INT,
  description TEXT,
  resolution TEXT,                      -- 'automated_in_followup' / 'remained_manual'
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 7.3 Drag-in detection

- **Active** — anh report khi xảy ra ("/dragin <workspace> <reason>").
- **Passive** — heuristics:
  - Anh edit code trong workspace repo (git log) outside agent commit.
  - Anh chạy CLI command trong workspace context > 5 min không trigger gate.
  - Anh fetch logs / DB query manually.

### 7.4 Auto-improve from drag-in

Mỗi drag-in event → auto-create RCA task: "What capability missing or auto-fail rate too high?"
- Auditor agent picks RCA, propose fix (new capability, threshold tune, skill update).
- Output: PR cho skill / capability / principle update.

→ Drag-in becomes **fuel for automation improvement**, không lặp lại.

---

## 8. Notification Batching Policy

### 8.1 Matrix per autonomy level

| Workspace level | Critical gate | High-risk gate | Medium gate | Low-risk gate | Info |
|---|---|---|---|---|---|
| sandbox | interrupt | digest | digest | digest | suppress |
| high | interrupt | digest 2x/day | digest 2x/day | weekly | suppress |
| medium | interrupt | hourly batch | hourly batch | digest 2x/day | weekly |
| low | interrupt | interrupt | hourly batch | hourly batch | digest |

### 8.2 Critical = hardcoded list

- Deploy live failures
- Hotfix needs decision
- Cost runaway active
- DSR with regulatory deadline < 7d
- Security incident active
- Train blocked > 24h

### 8.3 Digest UX

```
┌─────────────────────────────────────────────────────────┐
│  PAPERCLIP DIGEST — 2026-04-29 17:00 (afternoon)         │
├─────────────────────────────────────────────────────────┤
│  3 workspace active, 12 capability auto-resolved today    │
│                                                           │
│  PENDING (need confirm):                                  │
│  • [QuanLyChungCu] Sprint plan W17 ready (Confirm — 1m)  │
│  • [GymApp] Migration analyzed safe (Confirm — 30s)       │
│  • [CRM-X] Visual diff: design intent (Choose — 1m)       │
│                                                           │
│  ✓ AUTO-RESOLVED today (FYI):                             │
│  • 5 PR Tier 1 passed (auto-merge)                        │
│  • 2 canary advance (no breach)                           │
│  • 1 Hercules suite green                                 │
│                                                           │
│  [Open Approval Center] [Approve all if all confirm]     │
└─────────────────────────────────────────────────────────┘
```

→ 1-tap "Approve all" cho confirm-pattern gates trong digest.

---

## 9. Per-Workspace Autonomy Profile Schema

```sql
ALTER TABLE workspaces ADD COLUMN autonomy_profile JSONB DEFAULT '{
  "level": "medium",
  "promotion_threshold": {"low": 10, "medium": 20, "high": 50, "critical": 999999},
  "confidence_thresholds": {"low": 0.7, "medium": 0.8, "high": 0.9, "critical": 1.0},
  "notification_policy": "hourly_batch_with_critical_interrupt",
  "gate_quota_per_week": 8,
  "auto_promote_enabled": true,
  "auto_demote_enabled": true,
  "override_reasons": []
}'::jsonb;
```

### 9.1 Profile templates

```yaml
templates:
  sandbox:
    level: sandbox
    promotion_threshold: {low: 3, medium: 5, high: 10}
    confidence_thresholds: {low: 0.6, medium: 0.65, high: 0.75}
    gate_quota_per_week: 1
  
  startup-experimental:
    level: high
    promotion_threshold: {low: 5, medium: 10, high: 30}
    confidence_thresholds: {low: 0.7, medium: 0.75, high: 0.85}
    gate_quota_per_week: 3
  
  default:
    level: medium
    promotion_threshold: {low: 10, medium: 20, high: 50}
    confidence_thresholds: {low: 0.7, medium: 0.8, high: 0.9}
    gate_quota_per_week: 8
  
  regulated-fintech:
    level: low
    promotion_threshold: {low: 30, medium: 50, high: 100}
    confidence_thresholds: {low: 0.85, medium: 0.9, high: 0.95}
    gate_quota_per_week: 15
```

### 9.2 Apply template

```python
workspace.set_autonomy_profile(template='startup-experimental')
# Stored in workspaces.autonomy_profile JSONB
```

---

## 10. Migration from Current Design

### 10.1 Current state

Mọi capability default = "gate" (or undefined). Greenfield 4 gates. Strategic Loop 1 gate. Per-feature average ~5-10 gates.

### 10.2 Target state

Most capability auto-with-trust. Greenfield 1-2 gates (collapse). Strategic Loop 1 gate (sprint plan). Per-feature ~1-3 gates.

### 10.3 Migration steps

| Sprint | Effort | Action |
|---|---|---|
| 1 | 2d | Schema: `capability_trust_counters`, `human_drag_in_events`, `workspaces.autonomy_profile` |
| 2 | 2d | Capability default mode review (§3.2) — bulk update existing capability registry |
| 3 | 3d | Progressive trust algorithm (§4) — promote/demote logic + Brier integration |
| 4 | 3d | Confidence-driven gating (§5) — wire `ProposedAction.confidence` into routing |
| 5 | 4d | Auto-propose pattern catalog (§6) — refactor existing gates to confirm/choose/edit |
| 6 | 2d | Gate quota + drag-in tracker (§7) — schema + heuristics + RCA pipeline |
| 7 | 2d | Notification batching policy (§8) — digest cron + critical interrupt rules |
| 8 | 2d | Per-workspace autonomy profile UI + templates (§9) |
| 9 | 2d | Greenfield gate collapse (4 → 1-2) — single bundled review screen |
| 10 | 1d | Update 00-Master + Auto-Ops + Decision-Boundary to reference new policy |

Total: ~23 ngày eng work.

### 10.4 Rollout strategy

Per-workspace gradual:
- Week 1: enable on `sandbox` workspace (anh's experimental project).
- Week 2-3: enable on 1 `medium` workspace, observe gate count drop.
- Week 4: roll to all workspaces with default `medium` template.
- Week 5+: per-workspace autonomy override per anh's preference.

### 10.5 Backward compat

Existing capabilities default to gate (current behavior) until migrated. Capability có `auto-with-trust` mode requires explicit opt-in via capability registry update.

---

## 11. UX Implications — Approval Center Refresh

### 11.1 New layout

```
┌──────────────────────────────────────────────────────────────┐
│  APPROVAL CENTER          [All workspaces ▼] [Today ▼]        │
├──────────────────────────────────────────────────────────────┤
│  🔥 CRITICAL (1)                                              │
│   [QuanLyChungCu] Hotfix INC-892 → live  [Confirm: 30s]      │
│   ▸ Agent proposal: Patch SQL injection in /api/login        │
│     SQL diff: + escapeIdentifier() ; tests pass ; canary 5m  │
│     [Confirm] [Reject + reason]                              │
├──────────────────────────────────────────────────────────────┤
│  ⏳ PENDING CONFIRM (3, ~2 min total)                         │
│   • Sprint plan W17 (QuanLyChungCu) — Confirm 30s             │
│   • Migration safe (GymApp)         — Confirm 30s             │
│   • Visual diff intent (CRM-X)      — Choose 1m               │
│   [Approve all confirm-only]                                  │
├──────────────────────────────────────────────────────────────┤
│  📋 EDIT NEEDED (1, ~3 min)                                   │
│   • UX heuristic fix proposal (CRM-X) — Edit 3m               │
├──────────────────────────────────────────────────────────────┤
│  💭 NEED YOUR DECISION (1, ~10 min)                           │
│   • Auditor: principle conflict — Choose A/B/C                │
├──────────────────────────────────────────────────────────────┤
│  ✓ AUTO-RESOLVED today (24)  [Show details]                   │
│  ✓ Trust auto-promoted (2)   [pm.approve_sprint in CRM-X]     │
│  ⚠ Trust auto-demoted (0)                                     │
└──────────────────────────────────────────────────────────────┘
```

### 11.2 Per-item action buttons

Confirm pattern: 1 primary button "Confirm" + 1 secondary "Reject + reason".
Choose: A/B/C buttons với agent's recommended highlighted.
Edit: form fields + "Apply" / "Discard".
Decide: free-form text + "Submit decision".

### 11.3 "Approve all confirm-only" batch

Nếu tất cả pending là Confirm pattern → 1 button approve all (with timeout to read each item title).

### 11.4 Time tracking displayed

- Per-item estimated time.
- Per-day total estimated + actual time spent.
- Per-week / per-workspace breakdown.

→ Anh thấy được "tuần này tôi spend 35 phút trên Approval Center, target 40 phút — OK".

---

## 12. Concrete Examples — Walking Through Gates

### 12.1 Sprint plan (was Decide, now Confirm)

**Before:**
```
APPROVAL: Sprint Plan W17 for QuanLyChungCu
[Open detail page → review 8 stories, 3 PRs, capacity calc, ...]
[Approve] [Edit] [Reject]
```
Time: 10-15 min.

**After:**
```
[QuanLyChungCu] Sprint W17: 8 stories, 12d capacity, $42 budget   [▼]
  Agent reasoning: Last 3 sprints same workspace 94% completion,
  this sprint similar profile (story types, story points). 
  Confidence: 0.91. Brier-calibrated for this workspace: 0.08.
  
  [Confirm 30s] [Adjust...]  [Reject]
```
Time: 30s if confirm.

### 12.2 Visual diff (was Decide, now Choose)

**Before:**
```
APPROVAL: Visual diff exceeded threshold (0.4%)
[See diff image, baseline image, code change]
[Accept new baseline] [Block PR] [Manual review]
```

**After:**
```
[CRM-X] PR #234 visual diff 0.4% on /dashboard
  Agent classification:
   ▸ Design-intent change (75% confidence)
     Source: Designer ticket DES-89 "redesign chart spacing"
   ○ Unintended regression (15%)
   ○ Ambiguous, need eye (10%)
  
  [✓ Accept (design intent)] [✗ Block as regression] [Need eye]
```
Time: 1 min.

### 12.3 Greenfield gate collapse (4 → 1)

**Before:**
- Gate 1: approve personas (5 min)
- Gate 2: pick top 5 stories (10 min)
- Gate 3: approve tech stack (5 min)
- Gate 4: approve project brain (5 min)
Total: 25 min, 4 interrupts.

**After (single bundled review):**
```
[NEW WORKSPACE INTAKE] gym-app

Agent compiled full intake bundle:
  ▸ Personas (3): Casey, Lan, John  [Auto-ranked by market fit]
  ▸ Top stories (5): [list]         [Auto-ranked by impact/effort]
  ▸ Stack: Next.js + Postgres       [Confidence 0.88]
  ▸ Brain initial:                  [Auto-generated, edit if needed]
  
  Proposal pattern: Confirm bundle, OR per-section adjust
  
  [Confirm bundle 2m] [Adjust persona] [Adjust stories] [Adjust stack]
```
Time: 2-5 min, 1 interrupt.

### 12.4 Migration approval (was Decide, now Confirm with safety)

**Before:**
```
APPROVAL: Migration 0042 alter column users.email NOT NULL
[Review SQL] [Review impact analysis] [Approve]
```

**After:**
```
[GymApp] Migration 0042: ADD NOT NULL constraint to users.email
  Agent safety analysis (✓ all green):
   ✓ Backfill ran successfully on shadow DB (47K rows, 0 nulls remain)
   ✓ Application code already enforces non-null at write
   ✓ Reversible (ALTER COLUMN ... DROP NOT NULL)
   ✓ Zero-downtime: lock < 100ms expected
  Confidence: 0.94
  
  [Confirm 30s] [Investigate]
```
Time: 30s.

---

## 13. Schema Consolidated

```sql
-- Per-workspace autonomy
ALTER TABLE workspaces ADD COLUMN autonomy_profile JSONB;
ALTER TABLE workspaces ADD COLUMN autonomy_level TEXT DEFAULT 'medium';

-- Trust counter
CREATE TABLE capability_trust_counters (
  workspace_id TEXT,
  capability_id TEXT,
  consecutive_success INT DEFAULT 0,
  last_success_at TIMESTAMPTZ,
  total_invocations INT DEFAULT 0,
  total_successes INT DEFAULT 0,
  total_failures INT DEFAULT 0,
  current_mode TEXT,
  promoted_at TIMESTAMPTZ,
  demoted_at TIMESTAMPTZ,
  promotion_count INT DEFAULT 0,
  demotion_count INT DEFAULT 0,
  PRIMARY KEY (workspace_id, capability_id)
);
CREATE INDEX ON capability_trust_counters (workspace_id, current_mode);

-- Drag-in tracker
CREATE TABLE human_drag_in_events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT,
  trigger_kind TEXT,
  triggered_by TEXT,
  duration_minutes INT,
  description TEXT,
  resolution TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON human_drag_in_events (workspace_id, created_at DESC);

-- Approval enrichment
ALTER TABLE approval_items ADD COLUMN proposal_pattern TEXT;       -- confirm/choose/edit/decide
ALTER TABLE approval_items ADD COLUMN proposal_payload JSONB;
ALTER TABLE approval_items ADD COLUMN agent_confidence NUMERIC(3,2);
ALTER TABLE approval_items ADD COLUMN time_to_decision_seconds INT;
ALTER TABLE approval_items ADD COLUMN trust_counter_before JSONB;  -- snapshot
ALTER TABLE approval_items ADD COLUMN trust_counter_after JSONB;

-- Aggregate views
CREATE MATERIALIZED VIEW workspace_weekly_gate_count AS
SELECT workspace_id,
       date_trunc('week', created_at) AS week,
       COUNT(*) AS gate_count,
       SUM(time_to_decision_seconds) / 60.0 AS human_minutes,
       AVG(agent_confidence) AS avg_confidence
FROM approval_items
WHERE pattern != 'auto_resolved'
GROUP BY workspace_id, week;

CREATE MATERIALIZED VIEW capability_promotion_log AS
SELECT workspace_id,
       capability_id,
       promoted_at,
       demoted_at,
       consecutive_success,
       total_successes::float / NULLIF(total_invocations, 0) AS success_rate
FROM capability_trust_counters
ORDER BY promoted_at DESC NULLS LAST;
```

---

## 14. Updates to Existing Docs

All cross-doc syncs **applied 2026-04-29**:

| Doc | Update | Section | Status |
|---|---|---|---|
| 00-Master | North star: gate count + human time per week per project | §11 | ✅ Done |
| Autonomous-Operations §2 | Approval Center patterns (confirm/choose/edit/decide) | §2 | ✅ Done |
| Decision-Boundary §3.4 | Confidence threshold per autonomy level (`AUTONOMY_THRESHOLD_FACTOR`) | §3.4 | ✅ Done |
| Greenfield-Bootstrap §3.3 | Collapse 4 gates → 1 bundled | §3.3 | ✅ Done |
| Cross-Repo §2.2 | Brier > 0.15 → `block_trust_promotion` | §2.2 | ✅ Done |
| Autonomous-PM §4.4 | `planSprintNode` emits `proposed_action` Confirm/Edit | §4.4 | ✅ Done |
| Self-Healing §3 | Rule 7: Drag-in Detection (passive) | §3 | ✅ Done |
| Strategic Loop §11.1-§11.2 | Per-workspace cost forecast + autonomy-aware budget guard | §11 | ✅ Done |
| UX-Strategy §3.1 | Approval Center: Critical/Confirm/Choose/Edit/Decide/Auto-resolved/Trust/Cross-workspace | §3.1 | ✅ Done |
| UX-Strategy §7.3-§7.4 | Per-pattern mobile rendering + cross-workspace activity panel (Gap E + C) | §7 | ✅ Done |
| Paperclip-Platform §2.8 | Skill runtime contract (Gap B) | §2.8 | ✅ Done |
| Paperclip-Platform §9.5 | WFQ preemption events (Gap C) | §9.5 | ✅ Done |
| Paperclip-Platform §10.4 | `apply_template(workspace, name)` for 4 templates | §10.4 | ✅ Done |
| Greenfield §3.8 | Per-stage failure recovery state machine (Gap D) | §3.8 | ✅ Done |
| Strategic Loop §11.1 | `workspace_cost_forecast` table (Gap A) | §11.1 | ✅ Done |

---

## 15. Risk Mitigation

### 15.1 Risk: auto-promote a buggy capability

**Mitigation:** Brier calibration check (§4.3) blocks promotion if confidence not calibrated. Demote on first incident (§4.4). Auditor weekly review of promotion log.

### 15.2 Risk: anh không tin auto-promotion, vẫn manual review

**Mitigation:** "Auto-resolved today" section visible in Approval Center → anh có thể audit nếu muốn, không required. After 2-4 weeks confidence builds.

### 15.3 Risk: drag-in events hidden (anh debug silently)

**Mitigation:** passive detection (git log outside agent commit, CLI sessions in workspace). Active prompt anh tag drag-in via `/dragin`.

### 15.4 Risk: workspace autonomy level set wrong

**Mitigation:** Auto-recommendation cron weekly: based on stability metrics (incident rate, rejection rate, drag-in rate) → propose autonomy adjustment. Anh confirm.

### 15.5 Risk: notification policy too aggressive (suppress critical)

**Mitigation:** Critical hardcoded list (§8.2) bypass policy. Audit log every notification suppressed → reviewable.

### 15.6 Risk: capability default mode tweaked by mistake

**Mitigation:** Capability registry changes require PR + auditor sign-off. Security floor capabilities have hardcoded floor (cannot be overridden).

---

## 16. Score impact

| Khía cạnh | Trước doc này | Sau doc này |
|---|---|---|
| Decision automation rate | 5/10 | **9/10** |
| Gate count realistic for 30 projects | 3/10 | **8/10** (with phased target) |
| Trust progression / autonomy dial | 2/10 | **9/10** |
| Confidence-driven gating | 2/10 | **9/10** |
| Auto-propose UX | 5/10 | **9/10** |
| Gate batching | 5/10 | **8/10** |
| Drag-in monitoring | 2/10 | **8/10** |

**Aggregate vs mục tiêu "human = gate, rest = automated": 5/10 → 8.5/10.**

→ Đây là doc quyết định Paperclip thực sự autonomous hay chỉ là "human-in-the-loop dressed as autonomous".

---

## 17. North star recap

| Metric | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| Active workspaces | 1-5 | 5-15 | 15-30 |
| Gate / project / week | ≤ 8 | ≤ 5 | ≤ 3 |
| Auto-resolve rate | ≥ 70% | ≥ 85% | ≥ 92% |
| Human time / project / week | ≤ 60 min | ≤ 40 min | ≤ 25 min |
| Drag-in events / project / week | ≤ 2 | ≤ 1 | 0 |
| Median decision time | ≤ 5 min | ≤ 2 min | ≤ 1 min |
| Capability auto-promotion / week / workspace | ≥ 1 | ≥ 2 | ≥ 3 |
| Capability auto-demotion / week | ≤ 0.5 | ≤ 0.2 | ≤ 0.1 |

If Phase 3 hits → **anh có thể manage 30 dự án trong ~12.5h/week (25min × 30) = part-time.** Đây là true autonomous platform.

---

## 18. Liên kết

Foundational:
- [[00-Master-Architecture-Overview]] — north star integration
- [[Paperclip-Platform-Workspace-Mission-Model]] — workspace + capability override
- [[Autonomous-Operations-and-Human-Gate-Design]] — Approval Center base
- [[Decision-Boundary-and-Uncertainty-Model]] — confidence + reversibility matrix
- [[Cross-Repo-Coordination-and-Decision-Hardening]] — Brier calibration

Adjacent:
- [[Autonomous-PM-Strategic-Loop-Design]] — sprint approval as Confirm
- [[Greenfield-Bootstrap-Design]] — gate collapse
- [[UX-Strategy-and-Design]] — Approval Center layout
- [[Self-Healing-and-Liveness-Design]] — drag-in detection
- [[Rejection-Learning-and-Feedback-Loop]] — rejection signal feeds demotion

---

## 19. Open questions

1. **Exact threshold tuning** — promotion thresholds (10/20/50) là educated guess; cần real data từ Phase 1 to calibrate.
2. **Cross-workspace trust sharing** — nếu workspace A đã prove capability X, có thể auto-give workspace B head start? Default: no, fresh per workspace. Có thể tune.
3. **Anti-rubber-stamping** — nếu anh chỉ click "Approve all" mà không read → systemic risk. Mitigation: random "blind audit" 1/50 yêu cầu anh ghi rationale ngắn để verify attention.
4. **Multi-owner future** — nếu sau Paperclip có nhiều owner (anh + co-founder), gate routing per owner? Out of scope hiện tại.

→ Defer Phase 2+.
