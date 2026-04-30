---
id: TC-CP-11
name: WFQ scheduler fairness — 3 workspaces cạnh tranh agent pool
layer: integration
priority: P1
phases: [P3]
status: implemented
implemented_at: 2026-04-30
test_file: server/src/wfq-scheduler.test.ts
result: 4/4 pass
created: 2026-04-30
estimated_effort_hours: 5
---

# TC-CP-11 — WFQ fairness

## Mục tiêu
Verify WFQ (Weighted Fair Queue) scheduler chia đều agent pool cho 3 workspaces theo weight.

## Pre-condition
- 3 workspaces với weight: A=1.0, B=1.0, C=2.0
- 5 agents trong pool
- WFQ scheduler enabled

## Steps
1. Mỗi workspace submit 100 mission steps đồng thời
2. WFQ dispatch 300 steps → đo distribution
3. Expected: A=75, B=75, C=150 (theo weight)
4. Verify variance < 10%
5. Test starvation: nếu A submit 1000 steps, B/C có bị starve không?

## Expected
- Distribution theo weight
- Không có starvation
- Variance < 10%

## Acceptance checklist
- [ ] A: ~75 steps dispatched (±10%)
- [ ] B: ~75 (±10%)
- [ ] C: ~150 (±10%)
- [ ] Starvation test: B/C tối thiểu được serve ratio = weight
- [ ] Virtual finish time tracked
- [ ] Test với 10 workspaces, 50 agents — fair distribution

## Implementation notes
**File:** `server/src/platform/__tests__/wfq-fairness.integration.test.ts`

**Helpers:**
- `seedWorkspaces(weights)`
- `dispatchSteps(workspaceId, count)`
- `assertDistribution(actual, expected, tolerance)`

**Risk:**
- WFQ state in-memory only (per Performance eval) — restart mất state. Cần test cả persistence (nếu có)

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
