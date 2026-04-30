---
id: TC-CP-03
name: Greenfield 7-stage happy path — idea đến Sprint 1
layer: integration
priority: P0
phases: [P8]
status: implemented
implemented_at: 2026-04-30
test_file: server/src/greenfield-orchestrator.integration.test.ts + state-machine
result: 67 pass
created: 2026-04-29
estimated_effort_hours: 5
---

# TC-CP-03 — Greenfield 7-stage happy path

## Mục tiêu
Verify chuỗi 7 stage greenfield hoàn thành end-to-end và spawn được mission Sprint 1.

## Pre-condition
- 7 stage runners stub (idea_refinement, market_research, personas, stack, brain, repo_scaffold, sprint1)
- DB embedded
- Document store available

## Steps
1. Submit greenfield intake với `ideaTitle = "gym tracker app"`
2. `tick()` qua 7 stage tuần tự
3. Verify mỗi stage transition hợp lệ qua `canTransitionStage()`
4. Verify `documents` được tạo với key = `persona/<slug>` cho mỗi persona
5. Verify mission được spawn ở stage sprint1

## Expected
- `intake.status = completed`
- 7 stages tất cả `status = done`
- `repoUrl` có giá trị
- Document `brain/greenfield/<intakeId>` tồn tại
- Mission được tạo với feature_key = sprint1

## Acceptance checklist
- [ ] Intake state machine: refinement → research → personas → stack → brain → repo → sprint1 → done
- [ ] 7 rows trong `greenfield_stages` đều status=done
- [ ] ≥ 1 document `persona/*`
- [ ] Document `stack/*`, `market_research/*`, `brain/greenfield/*` tồn tại
- [ ] `repoUrl` non-null
- [ ] Mission row được tạo với `source_intake_id = intakeId`

## Implementation notes
**File:** `server/src/greenfield/__tests__/greenfield-7-stage.integration.test.ts` (mở rộng từ orchestrator test có sẵn)

**Helpers:**
- `stubAllStageRunners(orchestrator)` — pattern đã có
- `assertGreenfieldComplete(intakeId)` — helper kiểm tra 7 stages + docs + mission

**Risk:**
- Stage transitions có thể bị skip nếu canTransitionStage có bug — cần test cả negative path

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
