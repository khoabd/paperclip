---
id: TC-CP-04
name: Design doc conflict detection block merge
layer: integration
priority: P1
phases: [P7]
status: draft
created: 2026-04-29
estimated_effort_hours: 4
---

# TC-CP-04 — Design doc conflict detection block merge

## Mục tiêu
Verify khi 2 design docs cùng `component_path` ở trạng thái `in_dev`, conflict detector chặn merge.

## Pre-condition
- 2 design docs cùng status='in_dev'
- ConflictDetector available

## Steps
1. Tạo `design_doc A` cho component "auth/oauth.ts"
2. Tạo `design_doc B` cho cùng component path
3. Run ConflictDetector
4. Verify `conflict_events` được tạo với kind='api' hoặc 'behavior'
5. Thử merge `design_doc B` khi chưa resolve conflict

## Expected
- Merge bị block
- `conflict_events.resolved_at = NULL`
- `approval_item` được tạo cho human review

## Acceptance checklist
- [ ] 2 design_docs rows với cùng component_path
- [ ] `conflict_events` row có kind, severity
- [ ] Merge attempt throws/returns block
- [ ] `approval_items` row tạo, severity=MEDIUM
- [ ] Sau resolve: merge cho phép

## Implementation notes
**File:** `server/src/dev-flow/__tests__/conflict-detector.integration.test.ts`

**Edge cases:**
- 2 docs cùng path nhưng khác status (1 `in_dev`, 1 `merged`) → KHÔNG conflict
- Component path matching: exact match vs glob? Cần verify

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
