---
id: TC-CP-07
name: Cross-repo saga — atomic deploy và compensation
layer: integration
priority: P0
phases: [P12]
status: implemented
implemented_at: 2026-04-30
test_file: server/src/cross-repo/__tests__/saga-orchestrator.integration.test.ts
result: 4/4 pass (added 3-repo TC-CP-07 case)
created: 2026-04-29
estimated_effort_hours: 5
---

# TC-CP-07 — Cross-repo saga atomic deploy

## Mục tiêu
Verify saga 3-repo: nếu repo 3 fail, repos 1 & 2 rollback đúng; saga.status='compensated'.

## Pre-condition
- 3 repos configured trong saga
- `saga_steps` có 3 step

## Steps
1. Start saga với `feature_key = "auth-redesign"` (3 repos)
2. Repos 1 & 2 deploy thành công
3. Repo 3 fail (simulate timeout)
4. SagaOrchestrator chạy compensation
5. Verify repos 1 & 2 bị rollback
6. Verify saga.status='compensated'

## Expected
- Không có partial deploy
- Tất cả repos quay về trạng thái trước
- Approval item tạo cho failure

## Acceptance checklist
- [ ] saga row có status='compensated'
- [ ] saga_steps: 2 done → 2 compensated, 1 failed
- [ ] repos 1, 2 rollback verified (mock returns rollback called)
- [ ] approval_item tạo với severity=HIGH
- [ ] Test cả happy path: tất cả 3 repo success → status='committed'

## Implementation notes
**File:** `server/src/cross-repo/__tests__/saga-orchestrator-compensation.integration.test.ts`

**Helpers:**
- `mockRepoRunner(idx, behavior)` — programmatic success/fail per repo
- `assertCompensated(sagaId)`

**Risk:**
- Compensation có idempotent không? — test rerun
- Partial compensation (repo 1 rollback ok, repo 2 rollback fail) — escalation path?

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
