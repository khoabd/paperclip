---
tags: [architecture, autonomy, learning, feedback, design]
date: 2026-04-29
priority: P1
---

# Rejection Learning & Feedback Loop

> **Mục đích:** Khi human reject 1 đề xuất, Paperclip không chỉ retry mù — phải hiểu LÝ DO, học pattern, và điều chỉnh để không lặp lại sai lầm. Sau N lần fail cùng pattern → escalate "we keep failing here".

---

## 1. Vấn đề

Approval Center §2 lưu approve/reject status nhưng **chưa có closed-loop learning**:

- Human reject sprint plan vì "task estimate quá thấp" → Paperclip submit lại lần sau với estimate y hệt
- Human reject design vì "vi phạm principle X" → Paperclip không cập nhật rule preventing principle X violation
- Human reject feature vì "không phù hợp roadmap" → roadmap signal không feed lại Strategic Loop

→ Human thành "human eraser", phải reject hoài cùng issue.

**Yêu cầu:**
- Capture lý do reject có cấu trúc (không chỉ free text)
- Cluster rejections theo pattern (similar reason, similar context)
- Auto-adjust prompts/rules/brain để giảm khả năng lặp lại
- Escalate khi cùng pattern fail >3 lần (we-keep-failing-here)

---

## 2. Rejection Taxonomy

Mọi rejection bắt buộc chọn 1+ category:

| Category | Mô tả | Adjustment target |
|----------|-------|-------------------|
| `wrong_priority` | Đúng việc nhưng sai thời điểm | Strategic Loop priorization |
| `wrong_estimate` | Effort/cost ước sai | Velocity calibration |
| `wrong_scope` | Phạm vi quá to/nhỏ | Sprint planner prompt |
| `principle_violation` | Vi phạm nguyên tắc trong Brain | Brain principles + agent guards |
| `tech_choice_concern` | Stack/lib không phù hợp | Tech recommendation engine |
| `quality_concern` | Output sơ sài, thiếu test, etc. | QA agent strictness |
| `factual_error` | Thông tin sai (số liệu, ref) | Source verification step |
| `unclear_communication` | Diễn đạt khó hiểu | Output formatting prompt |
| `out_of_roadmap` | Không thuộc roadmap | Roadmap awareness in planner |
| `risk_too_high` | Rủi ro chấp nhận không nổi | Risk scoring threshold |
| `dup_or_overlap` | Đã có/đang có cái tương tự | Deduplication check |
| `security_concern` | Có thể tạo vulnerability | Security agent earlier in pipeline |
| `cost_too_high` | Cost vượt ngưỡng chấp nhận | Budget guard threshold |
| `other` | Free text bắt buộc | Manual review |

---

## 3. Feedback Capture UX

### Mandatory rejection dialog

```
┌────────────────────────────────────────────────┐
│ ❌ Reject: Sprint 12 Plan                      │
│                                                 │
│ Why? (pick 1+, then add detail)                │
│ [☑] Wrong estimate                             │
│ [☑] Out of roadmap                             │
│ [ ] Wrong priority                             │
│ [ ] ... (other categories)                     │
│                                                 │
│ Detail per category:                           │
│ ─ Wrong estimate:                              │
│   "Task #3 says 2 days, realistic is 5+"       │
│ ─ Out of roadmap:                              │
│   "Auth refactor isn't on Q2 roadmap"          │
│                                                 │
│ Severity: [○ Minor  ● Moderate  ○ Critical]   │
│                                                 │
│ What should be done instead? (optional)        │
│ [textarea]                                      │
│                                                 │
│ [Cancel]                    [Reject + Learn]   │
└────────────────────────────────────────────────┘
```

→ "Reject + Learn" stores structured feedback to `rejection_events`.

### Quick-reject for repeat patterns

If a similar rejection happened recently:
```
💡 Similar rejection 3 days ago: "Auth refactor not in roadmap"
   The system has been adjusted but this still slipped through.
   [Apply same reason]   [Different reason]
```

---

## 4. Pattern Detection

### 4.1 Rejection Embedding

Each rejection embedded with:
- `category` (one-hot vector)
- `context` (item type + project + agent + tags)
- `reason_text` (semantic embedding via sentence-transformers)

Stored in `rejection_events.embedding` (pgvector dim=1536).

### 4.2 Clustering

Nightly DBSCAN job over (category, context, reason_embedding):

```sql
-- Pseudocode
WITH clustered AS (
  SELECT id, dbscan_cluster(embedding, eps=0.3, min_samples=2) AS cluster_id
  FROM rejection_events WHERE clustered_at IS NULL
)
INSERT INTO rejection_patterns (cluster_id, pattern_summary, count, ...)
SELECT
  cluster_id,
  llm_summarize(reasons),
  COUNT(*),
  array_agg(DISTINCT category),
  AVG(severity_score)
FROM clustered
GROUP BY cluster_id
HAVING COUNT(*) >= 2;
```

### 4.3 Pattern → Action Map

| Pattern | Auto-action | Threshold |
|---------|------------|-----------|
| Same category + same agent ≥ 3 in 30d | Adjust agent prompt with rejection examples | 3 |
| Same category + same project ≥ 5 in 30d | Add principle to Brain | 5 |
| Estimate-related ≥ 5 across project | Recalibrate velocity factor | 5 |
| Roadmap-violation ≥ 2 | Force planner to load roadmap explicitly | 2 |
| Quality-concern ≥ 3 same agent | Increase QA strictness for that agent | 3 |
| Dup/overlap ≥ 2 | Add dedup check before submit | 2 |
| Security-concern ≥ 1 | Always run security agent before that decision type | 1 |
| Same pattern ≥ 3 AFTER auto-action applied | Escalate "we-keep-failing-here" | 3 |

---

## 5. Adjustment Mechanisms

### 5.1 Prompt augmentation
For "wrong_estimate" pattern → append to estimator prompt:
```
Recent rejections (last 30d):
- Sprint 11 task #5: estimated 2d, actual 7d (auth migrations harder than expected)
- Sprint 12 task #3: estimated 2d, rejected as "5+ realistic"
Calibration: when task involves auth/migration, multiply base estimate by 2.5x.
```

Stored in `learned_adjustments` with type=`prompt`.

### 5.2 Brain principle injection
For "principle_violation" pattern → propose new principle:

```yaml
proposed_principle:
  text: "Never propose breaking API changes without 2-week deprecation window"
  source: "Cluster of 3 rejections, Sprint 9-12"
  evidence: [rejection_event_ids]
  confidence: 0.85
```
→ Goes to Approval Center as `principle_addition` (low risk, auto-approve if confidence > 0.9).

### 5.3 Velocity recalibration
For "wrong_estimate" cluster → recompute velocity:

```python
new_velocity = old_velocity * (1 - rejection_rate * 0.5)
# capped at [0.3, 1.5] of original
```
Updates `project_brain.velocity_factor`.

### 5.4 Rule injection (hard)
For "out_of_roadmap" pattern → add precondition to planner:
```python
def plan_sprint(state):
    roadmap = load_roadmap(project_id)  # NEW: enforced load
    eligible_items = filter(
        lambda x: x.epic_id in roadmap.active_epics,
        candidates
    )
    ...
```
Tracked as `learned_adjustments` type=`rule`, can be reverted.

### 5.5 QA strictness boost
For "quality_concern" → increment `agent_capabilities.qa_strictness` for that agent + add review template.

### 5.6 Security agent insertion
For "security_concern" → modify pipeline to insert security agent before submit on related decision types.

---

## 6. Convergence Detection — "We Keep Failing Here"

```python
def check_convergence(pattern_id):
    p = db.fetch(pattern_id)
    if p.auto_actions_applied >= 1 and p.recurrence_after_action >= 3:
        # Pattern persists despite adjustments
        create_escalation({
            type: 'persistent_rejection_pattern',
            severity: 'high',
            pattern: p,
            message: f"After {p.auto_actions_applied} adjustments, "
                     f"this pattern recurred {p.recurrence_after_action} more times. "
                     f"Need human strategic input.",
            suggested_options: [
                'Manual prompt rewrite',
                'Disable auto-handling for this category',
                'Add explicit human-only gate for this scenario',
                'Mark as "out of scope" — stop trying'
            ]
        })
```

Escalation goes into Approval Center with **HIGH risk** and forces human strategic decision.

---

## 7. Database Schema

```sql
CREATE TABLE rejection_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_item_id UUID NOT NULL,
  rejected_by TEXT NOT NULL,
  categories TEXT[] NOT NULL,
  reason_details JSONB NOT NULL,    -- per-category detail text
  severity TEXT NOT NULL,            -- minor, moderate, critical
  alt_suggestion TEXT,
  context JSONB,                     -- item type, project, agent, tags
  reason_embedding vector(1536),
  cluster_id UUID,
  clustered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE rejection_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id UUID UNIQUE,
  pattern_summary TEXT NOT NULL,
  categories TEXT[] NOT NULL,
  scope TEXT,                       -- agent, project, system
  scope_id TEXT,
  count INT NOT NULL,
  severity_avg NUMERIC,
  first_seen TIMESTAMPTZ,
  last_seen TIMESTAMPTZ,
  auto_actions_applied INT DEFAULT 0,
  recurrence_after_action INT DEFAULT 0,
  status TEXT DEFAULT 'active'      -- active, resolved, escalated, abandoned
);

CREATE TABLE learned_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id UUID REFERENCES rejection_patterns(id),
  adjustment_type TEXT NOT NULL,    -- prompt, principle, velocity, rule, qa_strictness, security_insert
  target TEXT NOT NULL,              -- agent_id, project_id, etc.
  before_state JSONB,
  after_state JSONB,
  applied_at TIMESTAMPTZ,
  effectiveness_score NUMERIC,       -- updated after measuring post-application rejection rate
  reverted_at TIMESTAMPTZ,
  revert_reason TEXT
);
```

---

## 8. Effectiveness Measurement

For each `learned_adjustment`, measure 30 days post-application:
```
effectiveness = 1 - (recurrence_rate_after / recurrence_rate_before)
```

| Effectiveness | Action |
|---------------|--------|
| > 0.7 | Keep, mark as proven |
| 0.3 - 0.7 | Keep monitoring |
| < 0.3 | Revert + escalate |
| Negative | Revert immediately + escalate |

---

## 9. Implementation Roadmap

### Phase 0 — Capture (2 days)
- [ ] `rejection_events` table + embedding column
- [ ] Rejection dialog UX (mandatory category)
- [ ] Categorized reason capture API
- [ ] Quick-reject suggestion based on recent patterns

### Phase 1 — Clustering (3 days)
- [ ] Nightly clustering job (DBSCAN on pgvector)
- [ ] `rejection_patterns` aggregation
- [ ] Pattern viewer UI

### Phase 2 — Auto-adjustment (5 days)
- [ ] Prompt augmentation injector
- [ ] Brain principle proposer
- [ ] Velocity recalibrator
- [ ] Rule injector (planner preconditions)
- [ ] QA strictness updater
- [ ] Security agent insertion logic

### Phase 3 — Convergence + Escalation (2 days)
- [ ] Recurrence-after-action tracker
- [ ] Persistent-pattern escalation flow
- [ ] Effectiveness measurement cron

### Phase 4 — UX (2 days)
- [ ] Pattern dashboard ("we've adjusted X 3 times this month")
- [ ] Adjustment history per agent/project
- [ ] Effectiveness scorecard
- [ ] Revert adjustment UI

---

## 10. Liên kết

- [[Autonomous-Operations-and-Human-Gate-Design#2. Unified Approval Center]] — extends rejection capture
- [[Autonomous-PM-Strategic-Loop-Design#9. Internal Auditor]] — auditor reviews adjustment effectiveness
- [[Autonomous-PM-Strategic-Loop-Design#17. Work Efficiency Review]] — separate (post-success efficiency vs pre-rejection learning)
- [[Decision-Boundary-and-Uncertainty-Model]] — feeds calibration data
- [[UX-Strategy-and-Design#4. Critical User Flows]] — rejection dialog flow
