---
tags: [architecture, multi-repo, coordination, decision-boundary, rejection-learning, automation-mode]
date: 2026-04-29
status: design
depends_on:
  - "[[Knowledge-Base-Management-Strategy]]"
  - "[[Decision-Boundary-and-Uncertainty-Model]]"
  - "[[Rejection-Learning-and-Feedback-Loop]]"
  - "[[Autonomous-Operations-and-Human-Gate-Design]]"
---

# Cross-Repo Coordination & Decision Hardening

> Vá gap: nâng các dimension còn ở 6-7/10 lên 8+. Gồm: multi-repo atomic deploy, decision uncertainty calibration, rejection learning hiệu lực, knowledge consistency upgrade, Automation Mode hardening.

## 1. Multi-Repo Atomic Coordination

### 1.1 Vấn đề
`Knowledge-Base §5` đã có Repository Registry + Dependency Graph, nhưng chưa có cơ chế deploy atomic khi 1 feature span 3-5 repos (api + admin + mobile + iot + billing). Ví dụ: thêm field `payment_method` vào API → admin UI hiển thị → mobile read → billing tính phí. 4 repo cần đồng bộ.

### 1.2 Saga pattern cho cross-repo deploy

> **UPDATE 2026-04-29:** binding cross-repo SHAs giờ chuyển sang entity `release_trains` (xem [[Git-Branch-Tag-Release-Train-Strategy]] §5). Saga reference Train tag thay vì literal SHA list. Lý do: Train là artifact bất biến, có thể promote/rollback nguyên cụm; saga chỉ là orchestrator deploy. Schema dưới đây giữ `train_id` FK + `deploy_order` runtime info; SHAs ở `release_train_components`.

```sql
CREATE TABLE cross_repo_releases (
  id            UUID PRIMARY KEY,
  train_id      UUID NOT NULL REFERENCES release_trains(id),  -- bundle (repo,tag) source
  feature_key   TEXT NOT NULL,
  state         TEXT NOT NULL,       -- 'planning'|'building'|'deploying'|'verifying'|'completed'|'rolling_back'
  target_env    TEXT NOT NULL,       -- 'dev'|'stag'|'live'
  deploy_order  TEXT[] NOT NULL,     -- topological sort by dependency edges (runtime cache)
  rollback_order TEXT[] NOT NULL,    -- reverse + safety adjustments
  created_at    TIMESTAMPTZ DEFAULT now(),
  completed_at  TIMESTAMPTZ
);
-- repo+sha resolved at runtime from release_train_components (train_id, repo, ref_value)

CREATE TABLE cross_repo_steps (
  release_id    UUID REFERENCES cross_repo_releases(id),
  seq           INT,
  repo          TEXT,
  action        TEXT,                -- 'deploy_dev'|'deploy_stag'|'verify_contract'|'deploy_prod'
  state         TEXT,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  artifact      JSONB,
  PRIMARY KEY (release_id, seq)
);
```

### 1.3 Deploy order rules

Producer trước consumer:
- **Schema producer** (DB owner) → schema migration trước, **backward compatible required**.
- **API producer** (HTTP server) → deploy với new endpoint, OLD endpoint vẫn live (deprecation window).
- **API consumer** (web/mobile) → deploy sau, gọi new endpoint.
- **Schema cleanup** (drop old column) → chỉ chạy khi tất cả consumer đã ship + 30 ngày soak.

### 1.4 Contract evolution detector

Trước khi cho merge MR có thay đổi API/event/DB:
```python
def detect_contract_break(diff):
    breaks = []
    # API: OpenAPI/TypeSpec diff
    for endpoint in diff.changed_endpoints():
        if endpoint.removed_field: breaks.append(("removed_field", endpoint))
        if endpoint.required_field_added: breaks.append(("new_required", endpoint))
        if endpoint.type_changed: breaks.append(("type_change", endpoint))
    # Events: schema registry diff
    for event in diff.changed_events():
        if event.field_renamed: breaks.append(("renamed", event))
    # DB: drop column / drop table / not-null without default
    for migration in diff.migrations():
        if migration.has_drop_column(): breaks.append(("drop_col", migration))
        if migration.has_not_null_no_default(): breaks.append(("not_null", migration))
    return breaks
```

Nếu có break:
- Auto-create deprecation plan (12-tuần default), 2 versions live cùng lúc.
- Block merge cho tới khi:
  - Producer ship phiên bản backward compat.
  - Mỗi consumer repo có MR chuyển sang new contract.
  - Sunset PR auto-generated, scheduled sau N tuần.

### 1.5 Cross-repo orchestrator (LangGraph)

```
plan_release (architect agent reads dep graph → topology sort)
  → ensure_all_mrs_green (block until each repo MR has CI green)
  → deploy_dev_in_order (parallel within layer, sequential across layers)
  → run_e2e_tests (cross-repo integration suite)
  → deploy_stag_in_order
  → run_smoke + 1h soak
  → human_gate (Approval Center: "Promote cross-repo release X to prod?")
  → deploy_prod_in_order
  → verify_contract_consumers (poll downstream repos for traffic shift)
  → mark_completed
```

Failure ở bất kỳ step nào → trigger `rollback_in_reverse_order`. Rollback an toàn vì backward compat ở mỗi step.

### 1.6 Score uplift
Multi-repo coordination: **7/10 → 9/10**.

## 2. Decision Uncertainty Calibration

### 2.1 Vấn đề
`Decision-Boundary` đã có công thức composite uncertainty, nhưng chưa có cơ chế đảm bảo agent **calibrated** — tức khi agent nói "tôi 80% chắc", thực tế đúng ~80% lần.

### 2.2 Brier score nightly check

```sql
CREATE TABLE agent_predictions (
  id            UUID PRIMARY KEY,
  agent         TEXT NOT NULL,
  decision_id   UUID,
  predicted_p   NUMERIC,        -- 0-1, agent self-conf at decision time
  outcome       BOOL,            -- true=success, null=pending
  resolved_at   TIMESTAMPTZ
);
```

Cron nightly:
```python
def calibration_report():
    for agent in agents:
        rows = query("SELECT predicted_p, outcome FROM agent_predictions WHERE agent=? AND outcome IS NOT NULL AND resolved_at > now() - interval '30 days'", agent)
        brier = sum((p - int(o))**2 for p,o in rows) / len(rows)
        # bin into deciles, plot reliability curve
        bins = bucket_by_decile(rows)
        miscal = sum(abs(bin.mean_p - bin.actual_rate) * bin.weight for bin in bins)
        if miscal > 0.15:
            create_approval_item(
                kind="agent_calibration_drift",
                agent=agent,
                evidence=plot_reliability_curve(bins),
                proposed_action="adjust_confidence_temperature(agent, T)"
            )
            # Sync #2: block trust promotion when miscalibrated
            block_trust_promotion(agent, reason='brier_drift', until_brier_below=0.10)
```

Action: tự động tune Platt scaling (temperature on logits) hoặc adjust uncertainty composite weights cho agent đó. Khi `block_trust_promotion` active, [[Autonomy-Dial-and-Progressive-Trust-Design]] §4.3 progressive trust counter pause cho agent đó cho đến khi Brier hồi phục — chặn workspace miscalibrated tự promote silent.

### 2.3 Score uplift
Decision boundary: **7/10 → 8/10** (đã add closed-loop calibration).

## 3. Rejection Learning Effectiveness — Double Loop

### 3.1 Vấn đề
`Rejection-Learning` đã có 14-category + DBSCAN + 6 auto-adjust. Nhưng chưa kiểm tra: **adjustment có thật sự giảm rejection không**?

### 3.2 Meta-rejection loop

```sql
CREATE TABLE adjustment_outcomes (
  adjustment_id   UUID PRIMARY KEY REFERENCES adjustments(id),
  applied_at      TIMESTAMPTZ,
  baseline_rate   NUMERIC,        -- rejection rate trong 30d trước adjust
  post_rate_7d    NUMERIC,
  post_rate_30d   NUMERIC,
  effective       BOOL,
  side_effects    JSONB           -- e.g. velocity drop, false-positive uptick
);
```

Cron 30 ngày sau mỗi adjustment:
- Đo rejection rate cùng cluster.
- Nếu giảm < 30%: revert adjustment + escalate cluster lên "we-keep-failing-here".
- Nếu velocity giảm > 20%: revert + tune softer.
- Nếu side effect tạo cluster mới: emit insight, Strategic Loop pickup.

### 3.3 Cluster genealogy

Track cluster cha-con: nếu adjustment cho cluster A sinh cluster B (do over-correct), Strategic Loop nhìn cả family tree để tránh ping-pong.

### 3.4 Score uplift
Rejection learning: **7/10 → 8/10** (đã add closed-loop hiệu lực + genealogy).

## 4. Knowledge Consistency Upgrade

### 4.1 Vấn đề
`Decision-Boundary` đã có 4 consistency tier (real-time / near-real-time / eventual / periodic). Nhưng chưa có cơ chế detect **stale data dùng để quyết định**.

### 4.2 Vector clock cho brain snapshots

```sql
ALTER TABLE brain_snapshots ADD COLUMN vector_clock JSONB;
-- vector_clock = {"agent.architect": 47, "agent.engineer": 132, "rag.index_1": 9, ...}
```

Khi agent dùng snapshot:
- Read vector_clock của snapshot.
- Compare với current vector_clock của each upstream source.
- Nếu mismatch > threshold cho tier (ví dụ T-real-time tolerate 0, T-periodic tolerate 1d):
  - Force refresh upstream → re-snapshot.
  - Nếu không thể refresh → degrade decision tier (real-time → near-real-time, mark uncertainty +0.2).

### 4.3 Staleness budget per decision class

| Decision class | Max staleness | Action if exceeded |
|---|---|---|
| Production deploy approval | 5 min | Hard reject, refresh required |
| Sprint planning | 1 day | Soft warning, force refresh |
| Knowledge insight | 7 days | Auto-refresh trong background |

### 4.4 Score uplift
Knowledge consistency: **7/10 → 8/10**.

## 5. Automation Mode Hardening

### 5.1 Mục tiêu
Operator (anh) bật mode "auto-bypass-to-stag" — agent tự deploy local → dev → stag không cần gate. Production VẪN cần gate.

### 5.2 Schema

```sql
CREATE TABLE automation_mode_config (
  scope_type    TEXT NOT NULL,         -- 'global'|'tenant'|'project'|'feature'
  scope_id      UUID,
  state         TEXT NOT NULL,         -- 'manual'|'auto_to_dev'|'auto_to_stag'
  hard_floors   JSONB NOT NULL,        -- {"cost_usd_per_day": 100, "blast_radius_max": "medium"}
  enabled_at    TIMESTAMPTZ,
  enabled_by    UUID,
  expires_at    TIMESTAMPTZ,           -- safety: optional auto-disable after N days
  PRIMARY KEY (scope_type, scope_id)
);

CREATE TABLE automation_mode_audit (
  id            UUID PRIMARY KEY,
  ts            TIMESTAMPTZ DEFAULT now(),
  config_scope  TEXT,
  decision      TEXT,                  -- 'auto_approved'|'hard_floor_blocked'|'human_required'
  approval_id   UUID,                  -- link to bypassed Approval Center item
  reason        TEXT
);
```

### 5.3 Hard floors (luôn yêu cầu human)

Không bao giờ bypass dù mode bật:
1. **Production deploy** (`environment=production`).
2. **Data deletion** > 1k rows hoặc `DROP TABLE`.
3. **Cost runaway** (single-task cost > 5×median, daily aggregate > floor).
4. **Security finding** (CVE high/critical từ scanner agent).
5. **Compliance gate** (privacy review, DPA missing).
6. **Schema break** không có deprecation plan.
7. **First-time agent action** (agent chưa từng làm action type này trong tenant này — explicit consent first time).

### 5.4 Graduated trust

Operator bật mode lần đầu cho 1 project: 7-day trial.
- 7 ngày đầu: thông báo Slack mỗi action auto-approved (passive notify, không block).
- Operator có thể `ROLLBACK` action bất kỳ lúc nào → action đó vào blocklist + cluster này quay lại manual.
- Sau 7 ngày, ratio rollback/auto < 5% → graduated thành stable mode.
- Nếu > 5% rollback → mode tự degrade về manual + alert.

### 5.5 Approval Center UI khi mode bật

- Header banner: "Automation Mode active until {expires_at} for {scope}".
- Item list filter mặc định "Auto-approved (last 24h)" — operator review hậu kiểm.
- Mỗi item có button `ROLLBACK` (revert + add cluster to blocklist).
- Daily digest email: số auto-approved, số hard-floor block, top 5 actions theo cost.

### 5.6 Kill switch tích hợp

Mode bypass tự tắt nếu:
- `Self-Healing` raise level-3+ kill (project/global).
- `Auditor` drift score < 40.
- Compliance gap mới open.
- Operator absent > 14 ngày (heartbeat user logon → fallback manual).

### 5.7 Score uplift
Automation Mode: **6/10 → 9/10**.

## 6. Implementation effort

| Section | Effort | Phase |
|---|---|---|
| §1 Cross-repo orchestrator + saga | 7d | Sprint 4-5 |
| §2 Calibration Brier loop | 3d | Sprint 5 |
| §3 Adjustment outcome + genealogy | 3d | Sprint 6 |
| §4 Vector clock + staleness budget | 4d | Sprint 5 |
| §5 Automation Mode operational | 5d | Sprint 4 |

Total: ~22 ngày eng work.

## 7. Aggregated score uplift

| Dimension | Trước | Sau (combined với 4 doc khác) |
|---|---|---|
| Multi-repo coordination | 7 | **9** |
| Decision boundary | 7 | **8** |
| Rejection learning | 7 | **8** |
| Knowledge consistency | 7 | **8** |
| Automation Mode | 6 | **9** |
