---
id: TC-PRODUCT-05
name: Onboard new product khi product 1 đang busy
layer: e2e
priority: P1
phases: [P3, P8]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-30
estimated_effort_hours: 6
---

# TC-PRODUCT-05 — Onboard new product mid-flight

## Mục tiêu
Verify khi founder onboard product 2 lúc product 1 đang busy execution, không ảnh hưởng product 1, brain isolation đúng, agent pool fair share.

## Pre-condition
- Product 1 (workspace A) đang chạy với 5 active missions, agent pool busy
- Product 2 (workspace B) chưa exist

## Steps
1. Founder submit greenfield intake cho Product 2
2. Verify Product 1's missions không pause
3. Workspace B greenfield 7-stage runs (cần agent pool capacity)
4. WFQ phân bổ: A vẫn ưu tiên (đang trong sprint), B nhận share còn lại
5. B Stage 1-3 runs trong 24h
6. Verify Product 1 throughput không drop > 30%
7. B Sprint 1 spawn Day 7
8. Founder bump weight B = 2.0 (priority)
9. Verify share rebalance: A:B = 1:2

### Brain isolation check
10. Verify brain A và brain B độc lập
11. Insights A không leak sang B (trừ qua cross_workspace_learning table)

### Capability sharing
12. Agent X làm nhiều cho A, có capability_score tích lũy
13. B mission cần X — verify X được borrow, capability rating ưu tiên
14. Sau B mission xong, X return về pool

## Expected
- Product 1 không bị block
- Agent pool fair (theo WFQ)
- Brain isolation
- Capability ratings cross-workspace OK

## Acceptance checklist
- [ ] Workspace A throughput sau onboard ≥ 70% baseline
- [ ] Workspace B greenfield complete trong 7-10 days
- [ ] WFQ initial: A ≥ 70%, B ≤ 30%
- [ ] Sau weight bump: A=33%, B=67% (ratio 1:2)
- [ ] Brain A và B isolated (assertNoBrainCrossLeak)
- [ ] capability_score cho agent X cập nhật cross-workspace
- [ ] No mission die từ A khi onboarding B

## Implementation notes

**File:** `server/src/__tests__/product/multi-onboard.e2e.test.ts`

**Helpers:**
- `seedBusyWorkspace(missionCount, queueDepth)`
- `submitGreenfieldFor(workspaceB)`
- `measureThroughputDelta(workspaceA, beforeAfter)`
- `setWFQWeight(workspaceId, weight)`

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
