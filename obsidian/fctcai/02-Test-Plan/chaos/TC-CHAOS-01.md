---
id: TC-CHAOS-01
name: Kill agent mid-mission (Phase 6 kill switch)
layer: chaos
priority: P0
phases: [P6]
status: implemented
implemented_at: 2026-04-30
test_file: server/src/kill-switch.integration.test.ts
result: 4/4 pass
created: 2026-04-29
estimated_effort_hours: 5
---

# TC-CHAOS-01 — Kill agent mid-mission

## Mục tiêu
Verify kill switch level 3 (freeze-workspace) freeze toàn bộ missions trong workspace, double-confirm modal hoạt động, resume khôi phục đúng checkpoint.

## Pre-condition
- Mission đang ở `in_progress`, heartbeat đang emit
- Workspace có ≥ 2 missions active
- UI test với double-confirm modal

## Steps
1. UI: Click kill button với level=3 (freeze-workspace)
2. Verify double-confirm modal xuất hiện (Decide pattern)
3. Confirm kill (gõ "CONFIRM" để enable button)
4. Verify tất cả missions trong workspace bị pause
5. Verify `kill_switch_events` được log với level=3
6. Resume workspace sau khi issue cleared
7. Verify missions resume đúng từ checkpoint

## Expected
- Workspace freeze trong < 5 giây
- Resume khôi phục đúng trạng thái
- Không mất data
- Kill events có level đúng

## Acceptance checklist
- [ ] Modal yêu cầu gõ "CONFIRM" mới enable button
- [ ] All active missions chuyển status=paused
- [ ] `kill_switch_events` row có level=3
- [ ] Resume: tất cả missions chuyển back about active state
- [ ] Mission state pre-kill = state post-resume (no data loss)
- [ ] Test: cancel modal trước khi confirm → no kill happens

## Implementation notes
**File:** `server/src/platform/self-healing/__tests__/kill-switch-freeze-workspace.test.ts` + UI E2E test

**Helpers:**
- `seedActiveMissions(workspaceId, count)`
- `triggerKillUI(level, modal_action)`
- `assertWorkspaceFrozen()`

**Risk:**
- Snapshot mechanism: làm sao snapshot mission state trước khi pause? — cần spec rõ
- Resume race condition nếu workspace có heartbeats backlog

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
