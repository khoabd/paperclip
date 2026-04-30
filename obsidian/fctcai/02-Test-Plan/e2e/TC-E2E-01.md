---
id: TC-E2E-01
name: Daily 24h cycle — các cron job không xung đột
layer: e2e
priority: P0
phases: [P6, P9, P10]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-29
estimated_effort_hours: 6
---

# TC-E2E-01 — Daily 24h cycle

## Mục tiêu

Xác minh chu kỳ 24h gồm 4 cron job hằng ngày + watchdog ticks chạy đồng thời mà không deadlock, không double-process, và không drop event nào.

## Phase liên quan

- **P6 Self-Healing** — watchdog stuck detection
- **P9 Decision Boundary** — uncertainty calibration
- **P10 Rejection** — DBSCAN clustering

## Pre-condition

- Hệ thống có ≥ 1 active mission đang running
- DB có ≥ 5 `rejection_events` từ 7 ngày trước
- Embedded postgres test DB seeded
- Cron scheduler ở mode `manual-trigger` (không phụ thuộc thời gian thực)

## Steps

1. Giả lập 00:00 — kích `brain snapshot pruner` (manual trigger)
2. Kích `uncertainty calibration` (cron 02:00)
3. Kích `rejection clustering DBSCAN` (cron 03:00)
4. Kích `doc staleness scorer` (cron 04:00)
5. Trong khi 4 cron đang chạy: gửi 5 `heartbeat silence` (agent im lặng > 5 phút)
6. Xác nhận watchdog detect stuck → tạo `stuck_event`
7. Xác nhận `outcome tracker T+7` chạy và tạo `audit_report`

## Expected

- Tất cả 4 cron job hoàn thành thành công, không có unhandled exception
- `stuck_event` được tạo và escalate lên Approval Center
- `audit_report` có kết quả so sánh prediction vs reality
- Không có double-processing (idempotent)
- Tổng wall-clock < 5 phút (test mode)

## Acceptance checklist

- [ ] 4 cron job complete, exit code 0
- [ ] `stuck_event` có row với mission_id đúng
- [ ] `approval_items` có 1 row severity=HIGH cho stuck escalation
- [ ] `audit_report` row có `predicted_value` và `actual_value` populated
- [ ] Không có row duplicated (check unique constraint hoạt động)
- [ ] Logs không có ERROR/FATAL
- [ ] Memory không leak (heap stable trước/sau)

## Implementation notes

**File test:** `server/src/__tests__/e2e/daily-cycle.e2e.test.ts`

**Helpers cần:**
- `seedDailyCycleFixture(db)` — seed missions + rejection events + heartbeats
- `triggerCron(name)` — manual cron invoker (không dùng `node-cron` trong test)
- `waitForEscalation(approvalCenter, timeoutMs)`

**Stubs:**
- `BrainSnapshotPruner.run()` — đã có ở P6
- `UncertaintyCalibrator.calibrate()` — P9
- `RejectionClusterer.runDBSCAN()` — P10
- `DocStalenessScorer.score()` — P11

**Risk:**
- Test có thể flaky nếu watchdog tick rộng hơn 5 phút trong test → cần `vi.useFakeTimers()` để tua thời gian
- DBSCAN với dataset nhỏ → có thể không tạo cluster → cần seed ≥ 3 events cùng category

## Reviewer notes

> _Để trống cho user comment_

## Status flow

- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
