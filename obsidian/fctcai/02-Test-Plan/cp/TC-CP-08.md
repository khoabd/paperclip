---
id: TC-CP-08
name: Hotfix forward-port — cherry-pick conflict escalation
layer: integration
priority: P1
phases: [P13]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-29
estimated_effort_hours: 4
---

# TC-CP-08 — Hotfix forward-port

## Mục tiêu
Verify hotfix runner xử lý 3 case: auto cherry-pick OK, conflict resolve tự động, deep conflict escalate.

## Pre-condition
- Hotfix commit tồn tại trên branch `release/1.5`
- main branch có sẵn

## Steps
1. Hotfix runner cron kích (1h trigger)
2. **Case 1**: Auto cherry-pick thành công → verify auto-merge
3. **Case 2**: Inject simple conflict → agent resolve và retry
4. **Case 3**: Inject "deep conflict" (multi-file, semantic) → verify escalation lên Approval Center

## Expected
- 3 outcome handle đúng
- `approval_item` chỉ tạo cho Case 3
- main được update sau Case 1 và 2

## Acceptance checklist
- [ ] Case 1: main HEAD có hotfix commit, không approval
- [ ] Case 2: main HEAD có hotfix commit, agent ran (log có mark resolve attempt)
- [ ] Case 3: approval_item severity=HIGH, main không advance
- [ ] Hotfix metadata logged: `hotfix_attempts` table có row cho cả 3 case

## Implementation notes
**File:** `server/src/release/__tests__/hotfix-forward-port.integration.test.ts`

**Helpers:**
- `simulateGitState(scenario: 'clean' | 'simple_conflict' | 'deep_conflict')`
- `mockMergeAgent(behavior)`

**Risk:**
- "Deep conflict" detection: ngưỡng nào? File count, line count, semantic complexity? — cần spec rõ

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
