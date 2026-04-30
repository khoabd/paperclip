---
id: TC-INT-DRAGIN-01
name: Drag-in self-report aggregation (ADR-0008)
layer: integration
priority: P2
phases: [P3, ADR-0008]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-30
estimated_effort_hours: 3
---

# TC-INT-DRAGIN-01 — Drag-in aggregation

## Mục tiêu
Verify khi user toggle "drag-in" trên approval response, aggregate query đúng theo workspace × week, Efficiency Reviewer đọc và recommend.

## Pre-condition
- ADR-0008 schema applied (`metadata.dragIn` trong approval responses)
- Efficiency Reviewer service available

## Steps
1. Tạo 20 approval items, user respond:
   - 18 items: dragIn=false (normal)
   - 2 items: dragIn=true (manual intervention required)
2. Aggregate query: drag_in_rate per workspace per week
3. Verify rate = 2/20 = 10%
4. Run Efficiency Reviewer
5. Case A (rate < 10%): recommend autonomy bump
6. Case B (rate ≥ 20%): recommend autonomy reduce hoặc auditor review

## Expected
- Aggregate query đúng
- Efficiency Reviewer recommend đúng theo threshold

## Acceptance checklist
- [ ] dragIn metadata persist trong approval response
- [ ] Aggregate query trả về 10% cho test set
- [ ] Efficiency Reviewer Case A: recommend bump
- [ ] Case B (20%): recommend reduce
- [ ] Edge: 0% → no action
- [ ] Edge: 100% → critical alert

## Implementation notes
**File:** `server/src/efficiency/__tests__/dragin-aggregation.integration.test.ts`

**Helpers:**
- `seedApprovalsWithDragin(workspace, total, draginCount)`
- `runEfficiencyReviewer()`

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
