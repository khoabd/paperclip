---
id: TC-E2E-02
name: Weekly Strategic Loop — toàn bộ đến approve sprint
layer: e2e
priority: P0
phases: [P2, P3, P5, P9]
status: draft
created: 2026-04-29
estimated_effort_hours: 8
---

# TC-E2E-02 — Weekly Strategic Loop

## Mục tiêu

Verify Strategic Loop chạy weekly (Mon 08:00) tự động: collect signals → plan sprint → approval gate (nếu uncertainty cao) → dispatch tasks → audit → digest.

## Phase liên quan

- **P2 Strategic Loop** — main orchestrator
- **P3 Approval** — risk-gated approval
- **P5 Intake** — product_signals nguồn từ intake
- **P9 Decision Boundary** — uncertainty score → approval threshold

## Pre-condition

- Brain snapshot tồn tại với key='brain'
- `product_signals` có ≥ 5 items từ 7 ngày qua (mix: feedback, bug_report, feature_request)
- Engineering agents available (≥ 1 active)
- Approval Center API mocked

## Steps

1. Kích Strategic Loop (Mon 08:00 manual trigger)
2. Xác nhận `brain_snapshot` được freeze trước khi `collect_signals` chạy
3. Loop analyze signals → `plan_sprint` với N tasks (N ≥ 1)
4. **Nhánh A** (max uncertainty > 0.4): `approval_item` được tạo, workflow PAUSE
   - Human approve qua Approval Center API
5. **Nhánh B** (uncertainty ≤ 0.4): tự động proceed
6. Xác nhận tasks được dispatch sang engineering agents (`mission_steps` có rows)
7. Auditor chạy (Mon 09:00 trigger), tạo `audit_report`
8. Friday: Weekly digest gửi đi (mock Slack + email — verify payload)

## Expected

- Sprint plan có ≥ 1 task với `feature_key` populated
- `approval_item.risk_score` đúng theo công thức `risk = uncertainty * impact`
- Digest chứa "human attention items" section
- Brain snapshot không bị mutate trong loop (immutable freeze)
- Decision log có entry cho mỗi state transition

## Acceptance checklist

- [ ] `brain_snapshot.frozen_at` có giá trị trước collect_signals timestamp
- [ ] `mission_steps` có ≥ N rows
- [ ] `approval_items` row có risk_score đúng (test cả 2 nhánh)
- [ ] `audit_reports` row có created_at trong cùng ngày Mon
- [ ] Digest payload có mảng `human_attention` không rỗng nếu có pending approvals
- [ ] `decision_log` có ≥ 5 entries (mỗi state transition)
- [ ] Test cả 2 nhánh A và B trong cùng test file

## Implementation notes

**File test:** `server/src/__tests__/e2e/weekly-strategic-loop.e2e.test.ts`

**Helpers cần:**
- `seedProductSignals(db, count, mix)` — generate diverse signals
- `mockApprovalCenter(autoApprove: boolean)` — programmatic approve
- `mockSlackWebhook()` — capture digest payload

**Stubs:**
- `StrategicLoopOrchestrator.tick()` — entrypoint từ P4
- `BrainStore.freeze()` — verify immutability
- `SprintPlanner.plan()` — output validation

**Edge cases:**
- 0 signals → loop should skip (no sprint created)
- Tất cả signals đều low-uncertainty → no approval needed
- Approval timeout (1h) → mission goes to BLOCKED

## Reviewer notes

> _Để trống_

## Status flow

- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
