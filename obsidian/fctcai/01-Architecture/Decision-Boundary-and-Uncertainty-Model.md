---
tags: [architecture, autonomy, decision, uncertainty, design]
date: 2026-04-29
priority: P1
---

# Decision Boundary & Uncertainty Model

> **Mục đích:** Định nghĩa rõ "khi nào agent tự quyết, khi nào hỏi human" — dựa trên uncertainty + reversibility + blast radius. Giải quyết tension: hỏi quá nhiều → human bottleneck; tự quyết liều → sai lầm.

---

## 1. Vấn đề

Hiện 15 gate types (Auto Ops §8) liệt kê **WHAT** cần approve, nhưng KHÔNG có rule chung **WHEN** một quyết định mới phát sinh nên là gate hay tự quyết.

Khi agent gặp tình huống mới (chưa có gate type tương ứng):
- Agent A: tự quyết → có thể sai → human nổi giận
- Agent B: hỏi → tỉ lệ hỏi tăng → Approval Center quá tải

→ Cần **decision framework rõ ràng** để agent biết phải làm gì.

Ngoài ra: nhiều agent cùng quyết định trên data overlap → có thể inconsistent. Cần **consistency contract**.

---

## 2. Decision Framework — Reversibility × Blast Radius × Uncertainty

### 2.1 Three-axis evaluation

```
              Reversibility
           Easy  Medium  Hard
         ┌──────┬──────┬──────┐
   Low   │  A   │  A   │  H   │  A = Auto-decide
Blast    ├──────┼──────┼──────┤  H = Human gate
Radius   │  A   │  H   │  H   │
   Med   ├──────┼──────┼──────┤
         │  H   │  H   │  H   │
   High  └──────┴──────┴──────┘
```

Adjusted by **uncertainty**:
```
final_action = matrix_lookup(reversibility, blast_radius)
              IF uncertainty > threshold(decision_type) → escalate to H
```

### 2.2 Định nghĩa cứng

**Reversibility:**
- `easy` = revert in <5 min, no data loss (config flag, file edit, branch creation)
- `medium` = 5-60 min, minor data loss possible (db schema change with rollback ready)
- `hard` = >1 hour or permanent (delete data, public release, external API call, destructive migration)

**Blast Radius:**
- `low` = affects 1 task / 1 file / dev environment / single agent
- `medium` = affects multiple files / 1 service / staging environment / multiple agents
- `high` = affects production / multiple services / users / cost > $X / external systems

**Uncertainty:** see §3.

---

## 3. Uncertainty Estimation

### 3.1 Sources of uncertainty

| Source | How measured |
|--------|-------------|
| LLM self-confidence | Ask LLM "rate confidence 0-1" + verify with logprobs sampling |
| Historical accuracy | Agent's accuracy on similar past tasks (from outcome tracker) |
| Information completeness | % of relevant context loaded (KB hit rate) |
| Disagreement | Multi-agent voting variance |
| Novelty | Embedding distance from any known similar case |
| Source quality | Are inputs from trusted/verified sources? |

### 3.2 Composite uncertainty score

```python
def compute_uncertainty(decision_context):
    self_conf = llm_self_confidence(prompt, with_logprobs=True)   # 0-1
    historical = agent_historical_accuracy(agent_id, task_type)    # 0-1
    completeness = kb_coverage_score(decision_context)             # 0-1
    novelty = 1 - max_similarity_to_past_cases(decision_context)   # 0-1
    source_quality = avg_source_trust_score(decision_context)      # 0-1

    uncertainty = 1 - (
        0.25 * self_conf +
        0.25 * historical +
        0.20 * completeness +
        0.15 * (1 - novelty) +
        0.15 * source_quality
    )
    return uncertainty  # 0-1
```

### 3.3 Calibration

Nightly: compare `predicted_uncertainty` with `actual_outcome_correctness`:
- Predicted high uncertainty AND outcome correct → over-cautious
- Predicted low uncertainty AND outcome wrong → over-confident → tighten thresholds

```sql
INSERT INTO uncertainty_calibration (
  agent_id, task_type,
  window_start, window_end,
  predicted_uncertainty_avg, actual_error_rate,
  calibration_offset
) ...
```

`calibration_offset` adjusts future predictions: `adjusted = raw + offset`.

### 3.4 Confidence threshold per autonomy level — Sync #1

Base thresholds in §4 below are **scaled by workspace autonomy level**:

```python
AUTONOMY_THRESHOLD_FACTOR = {
    'sandbox': 0.6,    # gates only when uncertainty very high
    'high':    0.7,
    'medium':  0.8,
    'low':     0.9,    # gates almost everything (regulated)
}

def effective_threshold(decision_type, workspace):
    base = ESCALATION_THRESHOLD[decision_type]                    # §4 matrix
    factor = AUTONOMY_THRESHOLD_FACTOR[workspace.autonomy_level]
    return base * factor
```

Effect: a `Code style choice` (base 0.8) becomes 0.48 in sandbox (rarely gates) but 0.72 in low autonomy (often gates). See [[Autonomy-Dial-and-Progressive-Trust-Design]] §5 for confidence-driven gating end-to-end.

---

## 4. Escalation Threshold Matrix

| Decision type | Threshold (escalate if uncertainty >) |
|---------------|---------------------------------------|
| Code style choice | 0.8 |
| Test case selection | 0.7 |
| Library version pick | 0.5 |
| API design choice | 0.4 |
| DB schema change | 0.3 |
| Production rollout | 0.2 |
| Security-related | 0.1 |
| Cost > $X | 0.1 |
| Affecting external user | 0.15 |
| Data deletion | 0.05 |

Default: 0.5. Per-project override possible in Brain.

---

## 5. Decision Log — Single Source of Truth

Every non-trivial agent decision logged:

```sql
CREATE TABLE decision_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID,
  task_id UUID,
  agent_id TEXT,
  decision_type TEXT NOT NULL,
  decision_summary TEXT NOT NULL,
  options_considered JSONB,        -- list of alternatives with pros/cons
  chosen_option TEXT,
  rationale TEXT NOT NULL,
  reversibility TEXT NOT NULL,     -- easy, medium, hard
  blast_radius TEXT NOT NULL,      -- low, medium, high
  uncertainty NUMERIC NOT NULL,
  uncertainty_breakdown JSONB,     -- self_conf, historical, etc.
  routed_to TEXT NOT NULL,         -- auto, human_gate
  approval_item_id UUID,           -- if routed to human
  outcome TEXT,                    -- success, failure, partial
  outcome_recorded_at TIMESTAMPTZ,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

→ Becomes substrate for:
- "Explain" feature (UX §9)
- Auditor scoring (Strategic Loop §9)
- Consistency checks (§6)
- Rejection learning input

---

## 6. Consistency Model

### 6.1 The problem

Multiple tables represent overlapping state:
- `project_brain.metrics` (current state)
- `task_outcomes` (per-task)
- `service_metrics` (real-time)
- `efficiency_reviews` (per-task quality)

When agent reads each, they may be at different staleness → wrong decisions.

### 6.2 Consistency tiers

| Tier | Tables | Staleness budget | Read pattern |
|------|--------|------------------|--------------|
| **Real-time** | `service_metrics`, `liveness_heartbeats` | < 30s | direct read |
| **Near-real-time** | `task_outcomes`, `decision_log` | < 5 min | direct read |
| **Eventually consistent** | `project_brain`, `agent_capabilities` | < 1 hour | snapshot-based |
| **Periodic** | `audit_reports`, `efficiency_reviews` | < 24 hours | append-only |

### 6.3 Snapshot for strategic decisions

Strategic Loop reads `brain_snapshot` (frozen view) at start of run, not live brain:

```python
def strategic_loop_start(project_id):
    snapshot = create_brain_snapshot(project_id)
    state.brain = snapshot                 # frozen for entire run
    state.snapshot_id = snapshot.id        # for audit traceability
    ...
```

Updates to brain during run go to staging area, applied after run completes successfully (with conflict-resolution if needed).

### 6.4 Cross-table invariants

```sql
-- Invariant 1: every approved sprint plan has corresponding tasks
SELECT plan_id FROM approval_items
WHERE type='sprint_plan' AND status='approved'
  AND NOT EXISTS (
    SELECT 1 FROM tasks WHERE sprint_plan_id = approval_items.target_id
  );
-- If non-empty → violation → repair job

-- Invariant 2: every completed task has outcome record
SELECT task_id FROM tasks WHERE status='completed'
  AND NOT EXISTS (
    SELECT 1 FROM task_outcomes WHERE task_outcomes.task_id = tasks.id
  );

-- Invariant 3: every rejection has corresponding approval_item
SELECT id FROM rejection_events
  WHERE NOT EXISTS (
    SELECT 1 FROM approval_items WHERE id = rejection_events.approval_item_id
  );
```

Cron checks invariants every 30 min, repair or escalate on violation.

---

## 7. Multi-Agent Conflict Resolution

When 2 agents output conflicting decisions on same target within 15-min window:

### 7.1 Detection
```sql
SELECT target_id, COUNT(DISTINCT chosen_option), array_agg(agent_id)
FROM decision_log
WHERE created_at > NOW() - INTERVAL '15 min'
GROUP BY target_id
HAVING COUNT(DISTINCT chosen_option) > 1;
```

### 7.2 Resolution rules

| Conflict type | Resolution |
|---------------|-----------|
| Both low uncertainty, low blast | Pick higher historical accuracy agent |
| Mixed uncertainty | Pick lower uncertainty agent |
| Both high uncertainty | Escalate (no auto-pick) |
| One agent has more recent context | Pick that agent |
| Agents have different specializations | Pick closer specialist (skill-match score) |
| Tie | Escalate |

Resolution logged to `decision_log` with `routed_to='conflict_resolution'`.

---

## 8. Application — Wired into Existing Flows

### 8.1 Strategic Loop
- After `plan_sprint` node, decision_log entries created for each task pick
- `interrupt()` to human only triggers if any task uncertainty > 0.4

### 8.2 Engineering agents
- Code style choices → auto (uncertainty < 0.8)
- Library upgrades → log + auto if uncertainty < 0.5, else gate
- Schema changes → always gate (already in approval map)

### 8.3 Operations
- Auto-rollback on incident → uncertainty threshold = 0.2 (low → strict gate)
- Canary advance → uncertainty < 0.3 auto-advance, else hold

### 8.4 Greenfield Bootstrap
- Stage gates use threshold 0.4 (default for project-shaping decisions)
- Stack recommendation uses threshold 0.5 (medium uncertainty acceptable)

---

## 9. Database Schema (consolidated)

```sql
CREATE TABLE uncertainty_calibration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  sample_count INT,
  predicted_uncertainty_avg NUMERIC,
  actual_error_rate NUMERIC,
  calibration_offset NUMERIC,        -- additive correction
  updated_at TIMESTAMPTZ
);

CREATE TABLE consistency_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invariant_name TEXT NOT NULL,
  violating_records JSONB,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  repair_action TEXT,
  repaired_at TIMESTAMPTZ,
  escalated BOOLEAN DEFAULT FALSE
);

CREATE TABLE brain_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID,
  snapshot_data JSONB,
  taken_at TIMESTAMPTZ DEFAULT NOW(),
  used_by_workflow UUID,
  applied_at TIMESTAMPTZ            -- when staged updates merged back
);

-- decision_log defined in §5
```

---

## 10. Implementation Roadmap

### Phase 0 — Decision Log (2 days)
- [ ] `decision_log` table + embedding
- [ ] Wrapper for agent decisions to auto-log
- [ ] "Explain" UI reads from decision_log

### Phase 1 — Uncertainty Estimation (4 days)
- [ ] LLM self-confidence with logprobs
- [ ] Historical accuracy lookup
- [ ] KB coverage scorer
- [ ] Composite uncertainty function

### Phase 2 — Routing (3 days)
- [ ] Decision framework matrix implementation
- [ ] Threshold table + per-project override
- [ ] Auto-route vs gate decision wiring

### Phase 3 — Calibration (3 days)
- [ ] `uncertainty_calibration` cron
- [ ] Offset application in compute_uncertainty
- [ ] Calibration dashboard

### Phase 4 — Consistency (3 days)
- [ ] Brain snapshot mechanism
- [ ] Invariant cron (every 30 min)
- [ ] Repair playbook + escalation

### Phase 5 — Multi-Agent Conflict (2 days)
- [ ] Conflict detector
- [ ] Resolution rule engine
- [ ] Audit trail

---

## 11. Liên kết

- [[Autonomous-Operations-and-Human-Gate-Design#2. Unified Approval Center]] — escalation target
- [[Autonomous-PM-Strategic-Loop-Design#9. Internal Auditor]] — uses decision_log + calibration
- [[UX-Strategy-and-Design#9. "Explain" — Auditability Pattern]] — reads decision_log
- [[Self-Healing-and-Liveness-Design]] — decision-log informs stuck diagnosis
- [[Rejection-Learning-and-Feedback-Loop]] — feeds calibration adjustments
