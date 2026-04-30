---
id: TC-CP-02
name: Mission spawn từ intake — bridge integrity
layer: integration
priority: P0
phases: [P5, P2]
status: draft
created: 2026-04-29
estimated_effort_hours: 4
---

# TC-CP-02 — Mission spawn từ intake — bridge integrity

## Mục tiêu
Verify `IntakeMissionBridge` đảm bảo FK consistency, không tạo orphan, atomic.

## Pre-condition
- DB embedded Postgres
- IntakeMissionBridge available
- Intake fixtures ở candidates_ready state

## Steps
1. Tạo intake (feature_request), advance qua trạng thái `candidates_ready`
2. `selectCandidate(intakeId, idx=0)`
3. Verify `mission_id` được tạo trong table `missions`
4. Verify `intake.status = approved_solution`
5. Verify `mission.source_intake_id = intakeId`
6. Verify đây là atomic: nếu mission insert fail, intake KHÔNG advance

## Expected
- Mission được tạo, FK consistency đúng
- Không có orphan records
- Rollback đúng nếu mission insert fail

## Acceptance checklist
- [ ] Happy path: mission row tồn tại với FK
- [ ] Intake.status đúng giá trị
- [ ] Mission.source_intake_id matches
- [ ] Negative test: simulate mission insert fail → intake state không thay đổi
- [ ] Transaction wrapping verified

## Implementation notes
**File:** `server/src/intake/__tests__/intake-mission-bridge.integration.test.ts`

**Helpers:**
- `seedIntakeAtCandidatesReady(db)`
- `mockMissionInsertFail()` — inject error vào missions insert

**Risk:**
- Bridge hiện tại có wrap transaction không? Cần verify code.

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
