---
id: TC-CHAOS-05
name: Deadlock — hai agent chờ nhau
layer: chaos
priority: P0
phases: [P6]
status: draft
created: 2026-04-29
estimated_effort_hours: 4
---

# TC-CHAOS-05 — Deadlock detection

## Mục tiêu
Verify watchdog detect waiting-on cycle và kill cả 2 agents để giải phóng deadlock.

## Pre-condition
- 2 agents có `waiting_on` reference lẫn nhau
- Watchdog rule "deadlock" enabled

## Steps
1. Agent A: `waiting_on = mission_id_B`
2. Agent B: `waiting_on = mission_id_A`
3. Watchdog tick detect `hasWaitingOnCycle = true`
4. Watchdog rule "deadlock" fires
5. Verify cả 2 agents bị kill (priority restart)
6. Verify `stuck_event` được tạo cho cả 2

## Expected
- Deadlock detect trong 1 watchdog tick (< 60s)
- Cả 2 agents bị kill, không còn trong wait graph
- Hệ thống không bị treo sau deadlock resolution

## Acceptance checklist
- [ ] hasWaitingOnCycle return true
- [ ] Watchdog rule deadlock fires
- [ ] 2 kill_switch_events rows
- [ ] 2 stuck_events rows
- [ ] Sau kill: wait graph trống
- [ ] Test edge: 3-agent cycle (A→B→C→A) cũng detect

## Implementation notes
**File:** `server/src/platform/self-healing/__tests__/deadlock-detection.chaos.test.ts`

**Helpers:**
- `seedWaitingOnGraph(edges: [from, to][])`
- `runWatchdogTick()`
- `assertWaitGraphEmpty()`

**Edge cases:**
- 3-agent cycle
- Self-cycle (A waiting on A) — should be flagged immediately
- Long chain không cycle (A→B→C→D, D done) — không deadlock

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
