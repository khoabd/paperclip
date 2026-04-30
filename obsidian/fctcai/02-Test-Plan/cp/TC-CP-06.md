---
id: TC-CP-06
name: Brier calibration block trust promotion
layer: integration
priority: P1
phases: [P9]
status: draft
created: 2026-04-29
estimated_effort_hours: 3
---

# TC-CP-06 — Brier block trust promotion

## Mục tiêu
Verify nightly brier calibration block trust promotion khi brier > 0.15.

## Pre-condition
- 100 `decision_log` entries với `predicted_confidence` + `actual_outcome`
- Brier threshold = 0.15

## Steps
1. Run nightly brier calibration (02:30 cron trigger)
2. **Case A**: Brier score = 0.10 → trust promotion proceed
3. **Case B**: Inject Brier score = 0.18 → verify trust promotion bị block
4. Verify `brier_calibration` table cập nhật

## Expected
- Block condition chính xác tại threshold > 0.15
- `calibration_offset` được lưu (Platt scaling)
- Trust promoter return `{ allowed: false, reason: 'brier_degraded' }`

## Acceptance checklist
- [ ] Test cả 2 case A và B
- [ ] `brier_calibration` row có brierScore
- [ ] TrustPromoter returns đúng
- [ ] Edge: insufficient data (< 30) → reason='insufficient_data'
- [ ] Edge: brier exactly = 0.15 → boundary check

## Implementation notes
**File:** `server/src/brier/__tests__/brier-block-promotion.integration.test.ts` (có thể đã tồn tại — verify trước khi viết mới)

**Helpers:**
- `seedDecisionLog(count, predictedConfidences, actualOutcomes)`
- `runBrierCalibration()`

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
