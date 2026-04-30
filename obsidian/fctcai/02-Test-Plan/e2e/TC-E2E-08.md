---
id: TC-E2E-08
name: T+7 outcome tracker + Efficiency Reviewer learning loop
layer: e2e
priority: P1
phases: [P5, P9, P15]
status: draft
created: 2026-04-30
estimated_effort_hours: 6
---

# TC-E2E-08 — Outcome tracker + Efficiency Reviewer

## Mục tiêu
Verify T+7 sau deploy, outcome tracker so sánh prediction vs reality, Efficiency Reviewer học và đề xuất adjust autonomy/Brier.

## Pre-condition
- Mission deployed thành công 7 ngày trước
- Predicted: outcome_metric=user_engagement +10%, timeline=10 ngày
- Actual data available (mock metrics)

## Steps
1. T+7 cron trigger (manual)
2. Outcome tracker đọc mission → fetch actual metrics
3. **Case A: Prediction accurate** (delta < 20%)
   - audit_report status='accurate'
   - No autonomy change
4. **Case B: Prediction off** (delta > 50%)
   - audit_report status='off-target'
   - Brier score updated (worse)
   - Efficiency Reviewer recommend reduce autonomy on this capability
5. Verify decision_log có entry cho recommendation
6. Verify learning loop: future similar mission có adjusted confidence

## Expected
- Outcome tracker chạy đúng T+7
- Brier score reflect accuracy
- Recommendations propagate vào autonomy

## Acceptance checklist
- [ ] T+7 cron triggers outcome tracker
- [ ] audit_report row có actual + predicted
- [ ] Case A: status='accurate'
- [ ] Case B: status='off-target' + Brier worse
- [ ] Efficiency Reviewer recommendation persisted
- [ ] Future similar mission: confidence adjusted
- [ ] Test: 0 actual data (no metrics available) → status='no_data'

## Implementation notes
**File:** `server/src/__tests__/e2e/outcome-tracker-loop.e2e.test.ts`

**Helpers:**
- `seedDeployedMission(predictions, daysAgo)`
- `mockMetrics(missionId, actualOutcomes)`
- `runOutcomeTracker()`
- `runEfficiencyReviewer()`

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
