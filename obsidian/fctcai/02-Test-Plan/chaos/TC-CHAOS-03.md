---
id: TC-CHAOS-03
name: Cost runaway — mission vượt 2x estimate
layer: chaos
priority: P0
phases: [P6]
status: implemented
test_file: server/src/platform/self-healing/__tests__/watchdog-rules.test.ts
test_count: 4
note: Rule logic auto-mapped — watchdog-rules.test.ts covers ratio≥2 + floor $5 boundary. Full E2E pause-snapshot-approval flow needs orchestration harness (deferred).
created: 2026-04-29
estimated_effort_hours: 4
---

# TC-CHAOS-03 — Cost runaway

## Mục tiêu
Verify watchdog rule `cost_runaway` fire khi cost vượt ratio 2x (floor $5), pause + snapshot, escalate.

## Pre-condition
- Mission có `cost_estimate = $5`
- Watchdog rule cost_runaway: `ratio >= 2`, `floor $5`

## Steps
1. Simulate `cost_so_far_usd` vượt $10 (ratio = 2.1)
2. Watchdog detect cost_runaway
3. Verify mission pause + snapshot
4. Approval Center nhận item risk 70-90
5. Human approve "continue" hoặc "kill"
6. Cost guard scan (5-min cron) verify project budget check pass

## Expected
- Pause trong < 60 giây từ khi breach
- Snapshot lưu trước khi dừng
- Nếu kill: unused budget refund

## Acceptance checklist
- [ ] Watchdog tick detect breach
- [ ] Mission status='paused_cost_runaway'
- [ ] Snapshot row có timestamp
- [ ] approval_item severity=HIGH, risk_score 70-90
- [ ] Test cả 2 branch: continue + kill
- [ ] Kill branch: budget refund row tạo

## Implementation notes
**File:** `server/src/platform/self-healing/__tests__/cost-runaway.chaos.test.ts`

**Helpers:**
- `injectCostEvent(missionId, amountUsd)`
- `runWatchdogTick()`
- `mockApprovalDecision(action)`

**Edge cases:**
- Cost dưới floor ($3) ratio 5x → không fire (floor protect)
- Cost ratio = 2.0 exactly → boundary
- Multiple cost events trong 1 tick → aggregate đúng?

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
