---
id: TC-LOAD-03
name: Watchdog dưới heavy load — cron overlap
layer: load
priority: P1
phases: [P6]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-29
estimated_effort_hours: 6
---

# TC-LOAD-03 — Cron overlap idempotency

## Mục tiêu
Verify khi watchdog tick chạy lâu hơn cron interval (60s), tick thứ 2 không double-process.

## Pre-condition
- Watchdog cron 60s
- Simulate slow DB (latency inject 500ms/query)

## Steps
1. Giả lập watchdog tick chạy lâu > 60 giây (vì DB chậm)
2. Cron scheduler kích tick thứ 2 trong khi tick 1 chưa xong
3. Verify không có double-processing (idempotent guard)
4. Đo memory consumption qua 10 cron cycles

## Expected
- Không có stuck_event tạo 2 lần cho cùng 1 mission
- Memory leak không xảy ra (< 50MB tăng qua 10 cycles)
- Log cảnh báo nếu tick delay > 30s

## Acceptance checklist
- [ ] DB latency injected = 500ms/query
- [ ] Tick 1 và Tick 2 chạy concurrent
- [ ] Mỗi mission chỉ có 1 stuck_event row
- [ ] Heap snapshot delta < 50MB qua 10 cycles
- [ ] Log có warn entry "tick delay > 30s"
- [ ] Idempotency key: (mission_id, tick_started_at) hay equivalent

## Implementation notes
**File:** `server/src/platform/self-healing/__tests__/watchdog-cron-overlap.load.test.ts`

**Helpers:**
- `injectDBLatency(ms)`
- `runConcurrentTicks(count)`
- `measureHeapDelta()`

**Risk:**
- Watchdog hiện không có lock mechanism — cần advisory lock hoặc DB row lock
- Có thể test này expose bug → spec implementation trước

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
