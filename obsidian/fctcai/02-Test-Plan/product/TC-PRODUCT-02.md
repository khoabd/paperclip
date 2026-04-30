---
id: TC-PRODUCT-02
name: Multi-product (3 workspaces concurrent operation)
layer: e2e
priority: P0
phases: [P3, P4, P12]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-30
estimated_effort_hours: 12
---

# TC-PRODUCT-02 — Multi-product concurrent operation

## Mục tiêu
Verify 3 product workspaces chạy đồng thời, WFQ scheduler chia agent pool fair, không cross-contamination data, capability sharing hoạt động đúng.

## Pre-condition
- 3 workspaces đã setup (product A, B, C) với weight A=1, B=1, C=2
- Agent pool 5 agents
- Brain mỗi workspace isolated (key='brain' khác companyId)
- Cross-workspace learning enabled

## Steps

### Setup
1. Seed 3 workspaces với 1 active mission mỗi cái
2. Mỗi mission có 30 mission_steps queued

### Concurrent execution (simulated 7 days)
3. Time-skip 7 days, watchdog tick + scheduler chạy bình thường
4. WFQ dispatch: đo distribution (expected A=25%, B=25%, C=50%)
5. Verify mỗi workspace's brain KHÔNG chứa entity từ workspace khác
6. Verify cross-workspace learning: pattern từ A có propagate sang B/C qua `cross_workspace_learning` table

### Priority shift mid-week
7. Founder pause B (set autonomy='sandbox' tạm thời)
8. Verify A và C agent pool tăng share (B's quota redistribute)
9. Verify B's missions không die — chỉ pause

### Cross-product cleanup
10. Verify mỗi workspace có decision_log, audit_records riêng
11. Verify approval_items không lẫn workspace_id

## Expected
- WFQ distribution gần đúng weight (variance < 15%)
- Brain isolation: 0 cross-leak
- Cross-workspace learning: pattern transfer via table, không qua brain
- Pause B → A/C absorb quota
- No data lẫn

## Acceptance checklist
- [ ] WFQ distribution: A=25%±15%, B=25%±15%, C=50%±15%
- [ ] Mỗi workspace brain document có companyId đúng, 0 cross-reference
- [ ] cross_workspace_learning rows có entry sau 7 days
- [ ] Pause B: B's missions status='paused', A/C tăng dispatch share
- [ ] Resume B: WFQ quay về 25/25/50 trong 1 tick
- [ ] decision_log rows mỗi cái có companyId đúng
- [ ] approval_items không lẫn (query GROUP BY companyId không thiếu)
- [ ] Memory total ≤ 3x single-workspace memory (linear scaling)

## Implementation notes

**File:** `server/src/__tests__/product/multi-product-concurrent.e2e.test.ts`

**Helpers:**
- `seedWorkspaces(specs: { name, weight, autonomy }[])`
- `assertNoBrainCrossLeak(workspaceIds)` — query brain documents, check no foreign references
- `measureWFQDistribution(workspaceIds, sampleSize)`
- `pauseWorkspace(id)` / `resumeWorkspace(id)`

**Risk:**
- Cross-workspace learning chưa implement đầy đủ (per Business eval: "single-tenant không tạo data") → test có thể fail vì chưa có data flow
- Concurrent workspaces stress agent pool — có thể expose race conditions

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
