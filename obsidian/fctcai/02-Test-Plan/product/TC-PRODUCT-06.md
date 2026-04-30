---
id: TC-PRODUCT-06
name: Cross-product budget reallocation
layer: chaos-e2e
priority: P1
phases: [P3, P6, P15]
status: draft
created: 2026-04-30
estimated_effort_hours: 6
---

# TC-PRODUCT-06 — Cross-product budget reallocation

## Mục tiêu
Verify khi 1 product over-budget, founder shift $$$ sang product khác mà không lose work, auto-pause non-critical.

## Pre-condition
- 3 products A/B/C, mỗi cái budget = $100/week
- Product A đã spend $90 ngày 4 (90% budget)
- Product B đang ở $20, Product C ở $30

## Steps

### Auto-warning
1. Day 4: cost guard scan detect A ở 90%
2. Verify approval_item severity=MEDIUM cho founder warning
3. Watchdog cost rule fire (chưa runaway, chỉ warning)

### Founder reallocation
4. Founder action: "shift $40 from B (over-allocated) to A"
5. Verify budget_policies updated: A = $140, B = $60, C = $100
6. Verify mission tasks chạy không bị kill (chỉ adjust limit)

### Continued spending
7. Day 5: A spend đến $130 (still under new $140)
8. Day 6: A đụng $140 → cost runaway fire
9. Verify A pause non-critical missions, keep critical
10. Approval HIGH cho founder

### Resume
11. Founder approve "release additional $20 from emergency budget"
12. A resume, complete Sprint
13. End of week: aggregate cost report

## Expected
- Budget shift không kill mission
- Cost runaway pause non-critical, keep critical
- Audit trail complete cho mọi reallocation
- End-of-week report đúng total

## Acceptance checklist
- [ ] Cost guard detect 90% threshold
- [ ] approval_item severity=MEDIUM warning
- [ ] Reallocation: budget_policies rows updated
- [ ] No mission die khi shift budget
- [ ] Cost runaway tại $140: pause non-critical
- [ ] Critical missions tiếp tục
- [ ] Emergency budget release approved
- [ ] Weekly cost_attribution report đúng
- [ ] Decision_log có "BUDGET_REALLOCATION" entry với from/to amounts

## Implementation notes

**File:** `server/src/__tests__/product/cost-reallocation.chaos.test.ts`

**Helpers:**
- `seedWorkspaceWithBudget(name, budgetUsd, spentSoFar)`
- `reallocateBudget(fromWorkspace, toWorkspace, amountUsd)`
- `injectCostEvents(workspaceId, amountUsd)`
- `assertCriticalMissionsContinue(workspaceId)`

**Critical assumption:**
- Cần định nghĩa "critical" vs "non-critical" mission. Hiện chưa có flag rõ trong missions table.
- Cần feature: emergency budget pool — chưa có trong design hiện tại.

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
