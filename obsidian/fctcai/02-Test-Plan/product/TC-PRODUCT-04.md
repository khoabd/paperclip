---
id: TC-PRODUCT-04
name: Product pivot mid-flight (spec change)
layer: e2e
priority: P1
phases: [P4, P7, P11]
status: draft
created: 2026-04-30
estimated_effort_hours: 8
---

# TC-PRODUCT-04 — Product pivot mid-flight

## Mục tiêu
Verify khi product spec thay đổi giữa Sprint 5, ongoing missions adjust hoặc cancel, brain migrate, design docs supersede đúng cách, không lost work.

## Pre-condition
- Workspace có 5 sprints completed
- Brain với 50 insights, 10 design_docs status='merged'
- Sprint 6 đang chạy với 3 active missions

## Steps

### Pivot signal
1. Founder submit "strategic_input" intake: "Pivot from B2C to B2B, drop consumer features, focus on enterprise dashboard"
2. Verify intake classified type='strategic_input'
3. Strategic Loop emergency tick (manual trigger)

### Brain migration
4. Strategic Loop tạo brain_pivot proposal
5. Approval item HIGH risk cho founder review
6. Founder approve pivot
7. Verify brain document mới có key=`brain/pivot-2026-04` snapshot trước pivot
8. Verify brain main document được rewrite với new product direction
9. Decision_log entry "PIVOT_APPLIED"

### Mission cleanup
10. Verify 3 active missions:
    - Mission A (consumer feature): cancel với compensation
    - Mission B (general infra): keep, adjust acceptance criteria
    - Mission C (enterprise feature): keep, promote priority
11. Mission_state_transitions có rows cho mỗi adjust

### Design docs supersede
12. 10 design_docs được scan
13. Docs B2C-only: status='superseded' với supersede_reason
14. Docs general: keep
15. Docs B2B: priority bump

### New sprint
16. Strategic Loop spawn Sprint 7 với new direction
17. Verify Sprint 7 missions reflect B2B priorities

## Expected
- Pivot không lose existing work — brain snapshot preserved
- Ongoing missions adjusted gracefully
- Design docs lifecycle proper
- Audit trail complete

## Acceptance checklist
- [ ] strategic_input intake created
- [ ] approval_item HIGH cho pivot
- [ ] brain `brain/pivot-2026-04` snapshot exists
- [ ] brain main document updated
- [ ] decision_log entry "PIVOT_APPLIED"
- [ ] Mission A canceled với saga compensation
- [ ] Mission B/C status='active' với adjusted criteria
- [ ] design_docs có ≥ 1 row status='superseded'
- [ ] Sprint 7 missions có B2B feature_keys
- [ ] No orphan: mọi pre-pivot artifacts có FK đến snapshot

## Implementation notes

**File:** `server/src/__tests__/product/product-pivot.e2e.test.ts`

**Helpers:**
- `seedMatureWorkspace(sprintCount, brainInsights, designDocCount)`
- `submitStrategicInput(text)`
- `triggerStrategicEmergencyTick()`
- `assertPivotComplete(workspaceId)`

**Critical question (cần thiết kế thêm):**
- Brain "pivot" có phải là first-class concept không? — Hiện chưa có trong design.
- Mission "adjust acceptance criteria" có schema không? — Hiện chỉ có cancel/replan.

**Risk:**
- Test reveals design gap — pivot lifecycle chưa được design đầy đủ.
- Có thể cần ADR mới: ADR-0011 Product-Pivot-Lifecycle.

## Reviewer notes
> _Để trống — test này có thể expose design gap, cần discuss_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
