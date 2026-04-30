---
id: TC-CP-09
name: Autonomy Dial auto-promote sau N consecutive approvals
layer: integration
priority: P0
phases: [P3, P9]
status: implemented
implemented_at: 2026-04-30
test_file: server/src/autonomy-gate.test.ts + approval-router
result: 18 pass
created: 2026-04-30
estimated_effort_hours: 5
---

# TC-CP-09 — Autonomy auto-promote

## Mục tiêu
Verify khi capability có ≥20 consecutive human-approved decisions với 0 rejection trong 7 ngày, hệ thống auto-promote capability từ `gate` → `auto`.

## Pre-condition
- Autonomy Dial service available
- Capability registered ở level `gate`
- Brier calibration < 0.15 (baseline OK)

## Steps
1. Seed capability `feature.estimate.story_points` ở level=gate
2. Simulate 20 consecutive approvals (humanchọn approve, dragIn=false)
3. Run nightly autonomy promoter cron
4. Verify capability promoted lên `auto`
5. Test boundary: 19 approvals → no promotion
6. Test guard: brier > 0.15 → block promotion
7. Test guard: ≥1 rejection trong 7 ngày → reset counter

## Expected
- 20 consecutive + brier OK + 0 reject → promote
- Counter reset sau rejection
- Brier guard blocks

## Acceptance checklist
- [ ] 20 consecutive: capability_registry.level = 'auto'
- [ ] 19 consecutive: level vẫn 'gate'
- [ ] Brier > 0.15: no promote, audit log entry
- [ ] 1 rejection: counter reset về 0
- [ ] Promotion event: capability_promotion_events row tạo
- [ ] Test cả 4 levels: sandbox → low → medium → high

## Implementation notes
**File:** `server/src/autonomy/__tests__/auto-promote.integration.test.ts`

**Helpers:**
- `seedCapability(name, level)`
- `simulateApprovals(capability, count, allApproved)`
- `runAutonomyPromoter()`

**Risk:**
- AutonomyDial logic có thể chưa exist — test này cũng là implementation gate

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
