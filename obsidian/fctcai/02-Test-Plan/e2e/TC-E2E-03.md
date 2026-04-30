---
id: TC-E2E-03
name: Per-feature end-to-end — từ intake đến live (12 ngày simulated)
layer: e2e
priority: P0
phases: [P5, P7, P8, P11, P13, P14a]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-29
estimated_effort_hours: 10
---

# TC-E2E-03 — Per-feature E2E (intake → live)

## Mục tiêu

Verify pipeline đầy đủ từ khi user submit intake đến khi feature live trong production, đo wall-clock + human-active-time + cost.

## Phase liên quan

- P5 Intake
- P7 Dev Flow (PR Gate, design docs)
- P8 Greenfield (nếu mission là greenfield)
- P11 KB (Magika scan attachments)
- P13 Release Train (canary rollout)
- P14a Test Foundation (visual + a11y gate)

## Pre-condition

- Workspace có GitLab MCP hoạt động (mock instance)
- Ít nhất 1 engineering agent available
- 7 testing dimensions infrastructure ready
- Time-skip helper available

## Steps

1. **Day 0 — Submit intake**
   - Submit `feature_request` qua UI: "Add dark mode toggle"
2. **Day 0 — Triage**
   - `IntakeTriageAgent` phân loại → tạo 3 candidates
3. **Day 0 — Human chọn**
   - `selectCandidate(idx=0)` → mission spawned
4. **Day 1 — Engineering**
   - Agent tạo branch `feature/ATO-001`, mở MR
5. **Day 2 — PR Gate**
   - GitLab webhook kích PR Gate: lint, test, build, security scan, Optic
6. **Day 3 — Merge**
   - PR Gate pass → merged to develop → auto-deploy dev
7. **Day 4 — Train builder**
   - Train builder (30-min cron) gom feature_key, tạo train
8. **Day 5-7 — Promotion**
   - env/dev → approval → env/stag → soak 24h
9. **Day 8-11 — Canary**
   - canary 5% → 25% → 50% → 100%
10. **Day 12 — Live**
    - env/live promoted
11. **Day 12+7 — Outcome**
    - outcome tracker T+7 so sánh prediction vs thực tế

## Expected

- Toàn bộ flow hoàn thành < 12 ngày wall-clock (simulated)
- Human active time < 15 phút (chỉ approve + select candidate)
- Cost attribution chính xác trong `llm_cost_log`
- Outcome tracker có entry với delta < 30%

## Acceptance checklist

- [ ] `intake_items.status` chuyển `submitted → triaged → candidates_ready → approved_solution → completed`
- [ ] `missions` row có FK đến intake và đúng feature_key
- [ ] `mr_runs` row có status=passed cho PR Gate
- [ ] `feature_flags` row tồn tại với rollout 0→100%
- [ ] `release_trains` row có chứa feature_key
- [ ] `canary_runs` row có 4 stages 5/25/50/100
- [ ] `outcome_tracker` row T+7 có `actual_days` và `predicted_days`
- [ ] `llm_cost_log` total < budget threshold
- [ ] `human_interaction_log` (or proxy) ≤ 15 phút aggregate

## Implementation notes

**File test:** `server/src/__tests__/e2e/per-feature-pipeline.e2e.test.ts`

**Helpers cần:**
- `simulateTimeSkip(days)` — fast-forward cho Vitest
- `mockGitLabMCP()` — webhook + branch ops
- `assertMonotonicCost(rows)` — cost tăng đơn điệu
- `humanInteractionTimer()` — đo thời gian human active

**Stubs:**
- Magika scanner cho attachment (P11)
- Optic visual diff (P14a)
- Synthetic probe results (P14c)

**Risk:**
- Test này dài & phức tạp → split thành sub-fixtures
- Race condition giữa cron và explicit triggers

## Reviewer notes

> _Để trống_

## Status flow

- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
