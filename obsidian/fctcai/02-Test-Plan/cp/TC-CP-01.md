---
id: TC-CP-01
name: Intake type classification toàn bộ 8 loại
layer: unit
priority: P1
phases: [P5]
status: draft
created: 2026-04-29
estimated_effort_hours: 3
---

# TC-CP-01 — Intake type classification 8 loại

## Mục tiêu
Verify `IntakeTriageAgent` phân loại đúng cả 8 type và không cross-classify.

## Pre-condition
- IntakeTriageAgent configured với embedding model (mock)
- Fixtures: 8 sample text rõ ràng cho mỗi type

## Steps
Submit 8 intakes với text điển hình cho:
1. `problem` — "App load chậm 30s khi mở"
2. `feature_request` — "Thêm dark mode toggle"
3. `bug_report` — "Click submit báo lỗi 500"
4. `feedback_general` — "App rất tốt nhưng UI hơi rối"
5. `feedback_release` — "Bản 2.3 ra hôm qua tốt hơn 2.2"
6. `feedback_feature` — "Tính năng export PDF dùng tốt"
7. `strategic_input` — "Nên hướng tới SMB segment thay vì enterprise"
8. `question` — "Làm sao reset password?"

## Expected
- Mỗi intake type được predict đúng (8/8)
- Confidence ≥ 0.7 cho mỗi prediction
- Không có cross-classification (P → FR, BR → P, etc.)

## Acceptance checklist
- [ ] 8 fixtures có expected_type
- [ ] All 8 predictions match
- [ ] Confidence scores recorded
- [ ] Test có table-driven format (clear mapping)
- [ ] Mock embedding model deterministic

## Implementation notes
**File:** `server/src/intake/__tests__/intake-classifier-types.test.ts`

**Edge cases:**
- Text mơ hồ (chứa keyword cả 2 type) → expect lower confidence
- Text quá ngắn (< 10 chars) → fallback type = `question`?
- Empty text → throw

## Reviewer notes
> _Để trống_

## Status
- [x] Draft  
- [ ] Reviewed  
- [ ] Approved  
- [ ] Implemented
