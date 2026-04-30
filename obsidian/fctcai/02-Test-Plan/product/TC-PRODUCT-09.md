---
id: TC-PRODUCT-09
name: KPI delivery acceptance — North Star metrics
layer: acceptance
priority: P0
phases: [all]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-30
estimated_effort_hours: 6
---

# TC-PRODUCT-09 — KPI delivery acceptance

## Mục tiêu
Verify hệ thống đạt **North Star KPIs** đã hứa trong design:
1. ≤ 8 gates/project/week
2. ≤ 12.5h human time/week per founder
3. ≥ 2 features shipped per month
4. Brier < 0.15 sustained
5. Cost < $500/week per active product

## Pre-condition
- TC-PRODUCT-01 (90-day single-product) đã pass — dùng dữ liệu từ đó
- Hoặc seed equivalent 90-day workspace history

## Steps

### Aggregate metrics
1. Query approval_items: count gates per workspace per week
2. Query approval response times: sum per founder per week
3. Query missions completed status='done' với feature_key: count per month
4. Query brier_calibration: rolling 30-day average score
5. Query cost_events: sum per workspace per week

### Verify each KPI
6. **Gates/project/week ≤ 8**: filter rolling 7-day, group by workspace
7. **Human time ≤ 12.5h/week**: founder approval_response_times + drag-in time
8. **Features ≥ 2/month**: missions với feature_key, group by month
9. **Brier < 0.15**: latest brier_calibration row
10. **Cost < $500/week**: filter rolling 7-day cost

### Acceptance verdict
11. Generate report: each KPI pass/fail
12. If any fail → output explanation + blocking
13. If all pass → mark Full-System-Gate criterion 1+8 = real pass

## Expected
- 5/5 KPIs pass cho healthy workspace
- Report machine-readable + human-readable

## Acceptance checklist
- [ ] Gates/project/week measurable, average ≤ 8
- [ ] Human time measurable, ≤ 12.5h/week (sum approval response + drag-in)
- [ ] Features/month ≥ 2 verified
- [ ] Brier rolling 30-day < 0.15
- [ ] Cost weekly < threshold
- [ ] Report generation < 5s
- [ ] Report includes per-week breakdown (not just average)
- [ ] Edge: < 30 data points → "insufficient data" not "fail"

## Implementation notes

**File:** `server/src/__tests__/product/kpi-acceptance.test.ts`

**Helpers:**
- `aggregateKPIs(workspaceId, periodDays)`
- `assertKPIThresholds(report, thresholds)`
- `generateKPIReport(workspaceId)` — markdown + JSON output

**Critical observation:**
Per Business eval: 9/15 Full-System-Gate criteria là rubber stamp (`total ≥ 0` luôn true). TC-PRODUCT-09 là cách **CHUYỂN gate criterion 1 + 8 thành real check**.

**Should replace:**
- Criterion 1 (30 dự án 12.5h/tuần) → use TC-PRODUCT-09's human time aggregation
- Criterion 8 (Brier < 0.15) → đã đúng, keep
- Add: KPI dashboard từ TC-PRODUCT-09

## Reviewer notes
> _Để trống — đây là test biến Full-System Gate từ rubber stamp thành real_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
