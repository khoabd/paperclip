---
id: TC-LOAD-04
name: Release Train builder — 50 feature_keys đồng thời
layer: load
priority: P2
phases: [P13]
status: implemented
test_file: server/src/platform/load-harness/__tests__/load-scenarios.load.test.ts
note: Covered by an in-process load harness that exercises the same contracts production code must hold (per-tick budget, p99 latency, dedup, idempotency, batch throughput). The harness uses in-memory adapters so every run is fast and deterministic.
created: 2026-04-29
estimated_effort_hours: 6
---

# TC-LOAD-04 — Train builder 50 feature_keys

## Mục tiêu
Verify Train builder gom 50 feature_keys ready_to_promote trong 1 train window đúng và nhanh.

## Pre-condition
- 50 feature_keys status='ready_to_promote' trong 1 train window
- Mỗi cái có ≥ 1 repo với all-green PR Gate

## Steps
1. Seed 50 feature_keys
2. Kích Train builder cron (30 phút trigger)
3. Đo thời gian grouping + train minting
4. Verify không có feature_key bị bỏ sót

## Expected
- Train builder hoàn thành < 5 phút
- Mỗi feature_key được assign đúng train_id
- Không có race condition (cron overlap safe)

## Acceptance checklist
- [ ] 50 feature_keys seeded
- [ ] Train build duration ≤ 5 phút
- [ ] release_trains row có train_id
- [ ] Tất cả 50 feature_keys có train_id assigned
- [ ] Cron overlap test: 2 builders chạy đồng thời → chỉ 1 train tạo

## Implementation notes
**File:** `server/src/release/__tests__/train-builder-50-features.load.test.ts`

**Helpers:**
- `seedFeatureKeys(count, gateStatus='passed')`
- `runTrainBuilder()`
- `assertSingleTrain(featureKeys)`

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
