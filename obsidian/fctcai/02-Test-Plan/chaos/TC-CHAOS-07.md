---
id: TC-CHAOS-07
name: Kill switch level 4 — emergency-stop-all
layer: chaos
priority: P0
phases: [P6]
status: partial
partial_reason: Kill primitive (level=global) covered by kill-switch.integration.test.ts. Full notification dispatcher (PagerDuty/email) + orphan-tracker not yet built.
test_file: server/src/platform/self-healing/__tests__/kill-switch.integration.test.ts
created: 2026-04-30
estimated_effort_hours: 5
---

# TC-CHAOS-07 — Kill switch level 4 emergency-stop-all

## Mục tiêu
Verify level 4 emergency-stop-all dừng toàn bộ system không có orphan, fire escalation đầy đủ.

## Pre-condition
- 3 workspaces với 10 active missions tổng cộng
- 50 in-flight side effects (DB writes, API calls)

## Steps
1. Trigger kill level=4 (emergency-stop-all) — toàn instance
2. Verify tất cả 10 missions chuyển state='killed' trong < 5s
3. Verify tất cả pending mission_steps chuyển 'aborted'
4. Verify in-flight side effects: tracked + tagged orphan
5. Verify escalation: PagerDuty/email gửi đến on-call
6. Verify workspace_lifecycle_events có row cho mỗi workspace
7. Manual recovery: admin verify state, run cleanup script

## Expected
- Stop trong < 5s
- No orphan processes (best-effort tracking)
- Full escalation fired
- Manual recovery path documented

## Acceptance checklist
- [ ] 10 missions killed trong < 5s
- [ ] Pending steps aborted
- [ ] Orphan side effects logged trong rejection_events hoặc audit
- [ ] PagerDuty mock fires
- [ ] Email on-call sent
- [ ] kill_switch_events level=4
- [ ] No auto-resume (manual only)
- [ ] Cleanup script tested

## Implementation notes
**File:** `server/src/platform/self-healing/__tests__/kill-level-4.chaos.test.ts`

**Helpers:**
- `seedMultiWorkspaceMissions()`
- `simulateInFlightSideEffects(count)`
- `assertNoOrphan()`
- `assertEscalationFired(channels)`

**Risk:**
- Per Business eval: notification dispatcher chưa exist. Test này cũng là implementation gate.

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
