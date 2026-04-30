---
id: TC-LOAD-01
name: 100 concurrent missions — watchdog throughput
layer: load
priority: P1
phases: [P6]
status: draft
created: 2026-04-29
estimated_effort_hours: 8
---

# TC-LOAD-01 — Watchdog 100 concurrent missions

## Mục tiêu
Verify watchdog tick hoàn thành < 30s với 100 active missions, detect đúng 10 stalled, không miss.

## Pre-condition
- 100 missions active đồng thời
- Watchdog cron 60s
- Embedded postgres (mock latency 0)

## Steps
1. Seed 100 missions với active heartbeat
2. Giả lập 10 missions silent (stalled)
3. Chạy watchdog tick
4. Đo thời gian hoàn thành tick
5. Verify 10 stalled detected, 90 healthy bypassed

## Expected
- Watchdog tick < 30s với 100 missions
- 0 false negatives trong test set
- DB query < 5s (p99)

## Acceptance checklist
- [ ] 100 mission rows + 90 heartbeats
- [ ] Tick duration ≤ 30s
- [ ] 10 stuck_events tạo, 90 không
- [ ] DB query count đo được (≤ 200 queries/tick)
- [ ] Memory stable (heap snapshot trước/sau)

## Implementation notes
**File:** `server/src/__tests__/load/watchdog-100-missions.load.test.ts`

**Helpers:**
- `seedMissions(count, healthyRatio)`
- `measureTickDuration()`
- `countQueries(db)` — dùng query interceptor

**Risk:**
- Theo Performance eval (HOTSPOT 2): watchdog hiện tại sequential `buildCtx`, sẽ chậm với 100 missions. Test có thể fail luôn → cần fix (Promise.all) trước.
- Có thể là test "to-fail" để document hotspot.

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
