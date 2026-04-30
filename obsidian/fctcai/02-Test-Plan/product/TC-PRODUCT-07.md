---
id: TC-PRODUCT-07
name: Cross-product regression cascade (shared lib bump)
layer: chaos
priority: P1
phases: [P12, P14a]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-30
estimated_effort_hours: 6
---

# TC-PRODUCT-07 — Cross-product regression cascade

## Mục tiêu
Verify khi shared library bumped breaking, regression chỉ impact product affected, các product khác isolated, saga rollback chỉ scope đúng.

## Pre-condition
- 3 products A/B/C dùng shared lib `@org/auth-utils@1.5.0`
- Lib release `2.0.0` có breaking change

## Steps

### Lib bump
1. Day 0: Bot tự bump A từ 1.5 → 2.0
2. PR Gate: A's tests fail (regression detected)
3. PR Gate block A's bump
4. Cross-repo coordinator detect: B và C cũng dùng lib

### Cross-repo saga proposed
5. Saga proposes: bump all 3 atomically nếu regression solvable
6. Verify saga.steps có 3 step (1 per product)
7. Approval HIGH cho founder

### Founder choice
8. Founder choose: "only fix A, keep B/C on 1.5"
9. Saga aborted
10. A continues effort fix regression in standalone

### Independent fix
11. A's agent fix regression locally (override + adapter pattern)
12. PR Gate pass for A
13. A merge với new lib version
14. Verify B và C unaffected (lock file isolated)

### Cross-product check
15. Run synthetic probe across all 3 products
16. Verify no breakage anywhere

## Expected
- Regression detected tại A's PR Gate
- Cross-repo coordinator propose options, không auto-execute
- Founder có quyền choose scope
- Isolation: B/C unaffected throughout

## Acceptance checklist
- [ ] PR Gate fail cho A's lib bump
- [ ] Cross-repo coordinator detect 3 products use lib
- [ ] saga proposal với 3 steps
- [ ] approval_item HIGH cho scope decision
- [ ] Founder choose scope=A only → saga abort
- [ ] A's standalone fix complete
- [ ] B và C lock file unchanged
- [ ] Synthetic probe pass all 3
- [ ] Decision_log có "SCOPE_LIMITED" entry

## Implementation notes

**File:** `server/src/__tests__/product/regression-cascade.chaos.test.ts`

**Helpers:**
- `seedSharedLibUsage(workspaces, libName, version)`
- `bumpLibVersion(workspace, libName, fromVer, toVer)`
- `simulateRegressionFailure(workspace, prId)`
- `assertWorkspaceIsolation(workspaces)`

**Risk:**
- "Override + adapter" fix rất specific — test có thể quá synthetic
- Real-world: bot có khả năng tự fix breaking changes? — có thể chỉ propose human

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
