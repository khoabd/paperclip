---
id: TC-CP-05
name: Feature flag canary rollout 0→5→25→50→100%
layer: integration
priority: P1
phases: [P7, P13]
status: draft
created: 2026-04-29
estimated_effort_hours: 5
---

# TC-CP-05 — Canary rollout step-up

## Mục tiêu
Verify CanaryController advance đúng các stage 0→5→25→50→100%, require approval tại 50%, auto-rollback khi metric breach.

## Pre-condition
- `canary_run` được tạo cho `flag_id`
- Metrics system available (mock)

## Steps
1. Tạo `feature_flag` với status='canary', rollout_percent=0
2. CanaryController advance → 5%
3. Chờ 30 phút (simulated), verify metrics OK
4. Advance → 25% → 50% (require approval) → 100%
5. Verify `feature_flag.status = 'on'` sau 100%

## Expected
- Mỗi stage advance đúng percent
- Approval required tại 50%
- Nếu metric breach giữa stage → auto-rollback

## Acceptance checklist
- [ ] 5 stages advance đúng (0/5/25/50/100)
- [ ] Approval item tạo tại stage 50%
- [ ] Sau approve: stage = 100, status='on'
- [ ] Negative: inject metric breach → status='paused', auto-rollback
- [ ] `canary_runs` row có history đầy đủ

## Implementation notes
**File:** `server/src/dev-flow/__tests__/canary-controller.integration.test.ts`

**Helpers:**
- `simulateMetrics(passing|failing)`
- `advanceStage(controller, expectedNext)`
- `mockApproval(decision)`

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
