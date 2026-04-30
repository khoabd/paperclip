---
id: TC-INT-CALIBRATION-01
name: Nightly calibration cron updates calibration_offset correctly
layer: integration
priority: P1
phases: [P9]
status: draft
created: 2026-04-30
estimated_effort_hours: 4
---

# TC-INT-CALIBRATION-01 — Nightly calibration cron

## Mục tiêu
Verify nightly cron (02:00) đọc decision_log + outcomes, tính Platt scaling, update calibration_offset trong brier_calibration table.

## Pre-condition
- 100+ decision_log entries với predicted_confidence + actual_outcome
- Cron job manual trigger available

## Steps
1. Seed 100 decision_log entries với mix outcomes
2. Run nightly calibration cron
3. Verify `brier_calibration` row được update với:
   - `brier_score` recomputed
   - `calibration_offset` (Platt scaling) calculated
   - `sample_size` = 100
   - `recorded_at` timestamp
4. Verify subsequent `DecisionBoundaryEvaluator` calls dùng `calibration_offset` mới

## Expected
- Calibration offset chính xác (Platt scaling formula)
- Subsequent evaluations dùng offset mới

## Acceptance checklist
- [ ] brier_calibration row updated
- [ ] calibration_offset trong khoảng -1 đến 1
- [ ] sample_size đúng count
- [ ] DecisionBoundaryEvaluator output thay đổi sau calibration
- [ ] Edge: <30 samples → no update (insufficient data)
- [ ] Consistency invariant cron (30-min) bắt được mismatch giữa decision_log và brier_calibration

## Implementation notes
**File:** `server/src/brier/__tests__/calibration-cron.integration.test.ts`

**Helpers:**
- `seedDecisionLog(count, confidenceDistribution)`
- `runCalibrationCron()`
- `assertPlattScaling(actualOffset, expectedOffset, tolerance)`

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
