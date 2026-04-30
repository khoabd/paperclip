---
id: TC-CP-10
name: Gate quota breach triggers auditor review
layer: integration
priority: P0
phases: [P3, P9]
status: draft
created: 2026-04-30
estimated_effort_hours: 4
---

# TC-CP-10 — Gate quota breach

## Mục tiêu
Verify khi workspace vượt quota gates/week (default ≥ 8), auditor được trigger để review autonomy config.

## Pre-condition
- Workspace với autonomy_level='medium', gate_quota_per_week=8
- Auditor service available

## Steps
1. Workspace bắt đầu tuần với 0 gates
2. Inject 9 gates trong tuần
3. Run weekly autonomy auditor (Sun 23:00 cron)
4. Verify auditor flag workspace với gate_quota_breached=true
5. Verify auditor recommend: "increase autonomy" hoặc "review gate triggers"
6. Approval item tạo cho human review

## Expected
- Quota breach detected
- Auditor recommend đúng
- Approval item tạo

## Acceptance checklist
- [ ] 9 gates trong 7 ngày: breach=true
- [ ] 8 gates: breach=false (boundary)
- [ ] auditor_reports row có recommendation
- [ ] approval_item severity=MEDIUM
- [ ] Edge: 0 gates → underutilized warning?
- [ ] Reset counter mỗi tuần

## Implementation notes
**File:** `server/src/autonomy/__tests__/gate-quota.integration.test.ts`

**Helpers:**
- `injectGates(workspaceId, count)`
- `runWeeklyAuditor()`

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
