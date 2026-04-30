---
id: TC-CHAOS-06
name: Kill switch level 2 — pause-workspace gracefully
layer: chaos
priority: P0
phases: [P6]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-30
estimated_effort_hours: 4
---

# TC-CHAOS-06 — Kill switch level 2 pause-workspace

## Mục tiêu
Verify level 2 (pause-workspace) pause toàn bộ active missions trong workspace gracefully và resume đúng state.

## Pre-condition
- Workspace có 5 active missions, mỗi cái ở state khác nhau (planning, executing, reflecting)
- Kill switch service ready

## Steps
1. Trigger kill level=2 (pause-workspace)
2. Verify tất cả 5 missions pause với checkpoint
3. Verify mission_state_transitions có entry cho pause
4. Verify in-flight side effects complete (không bị cut giữa chừng)
5. Sau 1h, resume workspace
6. Verify 5 missions resume từ exact checkpoint
7. Verify final state đúng (so với non-pause baseline)

## Expected
- Graceful pause: side effects complete trước khi pause
- Resume khôi phục đúng state
- Total downtime tracked

## Acceptance checklist
- [ ] 5 missions paused
- [ ] Mỗi mission có checkpoint row
- [ ] Side effect count = baseline (no double, no missing)
- [ ] Resume từ checkpoint
- [ ] Final state matches baseline
- [ ] kill_switch_events level=2

## Implementation notes
**File:** `server/src/platform/self-healing/__tests__/kill-level-2.chaos.test.ts`

**Helpers:**
- `seedMixedMissions(workspaceId, states)`
- `assertGracefulPause(missionId)`

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
