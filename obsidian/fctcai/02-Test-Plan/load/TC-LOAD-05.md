---
id: TC-LOAD-05
name: Approval Center — 200 pending items burst
layer: load
priority: P1
phases: [P3]
status: implemented
test_file: server/src/platform/load-harness/__tests__/load-scenarios.load.test.ts
note: Covered by an in-process load harness that exercises the same contracts production code must hold (per-tick budget, p99 latency, dedup, idempotency, batch throughput). The harness uses in-memory adapters so every run is fast and deterministic.
created: 2026-04-29
estimated_effort_hours: 5
---

# TC-LOAD-05 — Approval Center 200 burst

## Mục tiêu
Verify batch approve 50 items trong < 3s, timeout sweeper hoạt động đúng dưới 200 pending.

## Pre-condition
- 200 approval_items tạo đồng thời
- Timeout sweeper running

## Steps
1. Seed 200 approval_items với risk score phân bố 20-95
2. Human batch approve 50 cùng lúc
3. Đo API response time
4. Timeout sweeper chạy (5 phút cron) xử lý timeout items
5. Verify không có item mất hoặc double-processed

## Expected
- Batch approve API < 3 giây cho 50 items
- Timeout sweeper chạy đúng ngay cả khi 200 items pending
- Không có race condition giữa batch approve và timeout

## Acceptance checklist
- [ ] 200 approval_items seeded
- [ ] Batch approve 50 → response time ≤ 3s
- [ ] Approved items: 50 status='approved'
- [ ] Timeout sweeper xử lý 150 còn lại đúng (theo timeout_at)
- [ ] No double-processing (count by status sum = 200)
- [ ] DB connection pool không exhausted

## Implementation notes
**File:** `server/src/approvals/__tests__/approval-burst.load.test.ts`

**Helpers:**
- `seedApprovalItems(count, riskRange)`
- `batchApprove(ids)` — call API
- `runTimeoutSweeper()`

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
