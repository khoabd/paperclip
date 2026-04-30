---
id: TC-INT-APPROVAL-TIMEOUT-01
name: Approval timeout_action mechanics + delegation flow
layer: integration
priority: P0
phases: [P3, ADR-0009]
status: implemented
test_file: server/src/approvals/__tests__/approval-timeout.integration.test.ts
test_count: 7
created: 2026-04-30
estimated_effort_hours: 5
---

# TC-INT-APPROVAL-TIMEOUT-01 — Timeout + delegation

## Mục tiêu
Verify khi approval hết `timeout_hours`, hệ thống thực thi `timeout_action` (auto-approve/auto-reject/escalate). Verify delegation flow.

## Pre-condition
- ADR-0009 schema đã apply
- Approval timeout sweeper cron available

## Steps
1. **Case auto-approve:**
   - Tạo approval với `timeout_hours=1, timeout_action='auto-approve'`
   - Skip clock 1.1h
   - Run timeout sweeper
   - Verify status='approved', `time_to_decision_seconds` populated
2. **Case auto-reject:**
   - Tạo approval với `timeout_action='auto-reject'`
   - Sau timeout: status='rejected'
3. **Case escalate:**
   - Tạo approval với `timeout_action='escalate'`
   - Sau timeout: priority bumped lên cao hơn, can_delegate=false
4. **Delegation:**
   - Tạo approval `can_delegate=true`
   - Original approver delegate sang user khác
   - Verify `delegated_to_user_id` populated
   - Verify chỉ delegated user mới approve được

## Expected
- 3 timeout actions hoạt động đúng
- Delegation flow secure (chỉ delegated user approve)

## Acceptance checklist
- [ ] auto-approve case
- [ ] auto-reject case
- [ ] escalate case
- [ ] Delegation: thay đổi delegated_to_user_id
- [ ] Delegation: original approver KHÔNG approve được sau delegate
- [ ] Delegation: non-delegated user KHÔNG approve được
- [ ] `time_to_decision_seconds` chính xác
- [ ] Audit log có entry cho mỗi timeout_action

## Implementation notes
**File:** `server/src/approvals/__tests__/approval-timeout.integration.test.ts`

**Helpers:**
- `seedApprovalWithTimeout(timeoutHours, timeoutAction)`
- `skipClock(hours)` — vi.useFakeTimers()
- `runTimeoutSweeper()`

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
