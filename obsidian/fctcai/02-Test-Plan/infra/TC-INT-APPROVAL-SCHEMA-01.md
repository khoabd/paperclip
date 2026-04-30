---
id: TC-INT-APPROVAL-SCHEMA-01
name: Approvals 11 cột mới — migration backward compat + Zod schemas
layer: integration
priority: P0
phases: [P3, ADR-0009]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-30
estimated_effort_hours: 6
---

# TC-INT-APPROVAL-SCHEMA-01 — Approvals migration + Zod

## Mục tiêu
Verify migration ADR-0009 thêm 11 cột vào `approvals` không phá existing rows, và Zod discriminatedUnion validate đúng theo `(type, proposal_pattern)`.

## Pre-condition
- DB có existing approval rows (pre-migration state)
- Zod schemas tại `packages/shared/src/approvals/schemas.ts`

## Steps
1. Seed 10 approval rows với schema cũ (pre-ADR-0009)
2. Run migration ADR-0009 (add 11 columns)
3. Verify existing 10 rows: cột mới có default values (nullable hoặc default)
4. Verify new insert với full payload (Zod validate)
5. Test 4 proposal_pattern: `confirm`, `choose`, `decide`, `delegate`
6. Each pattern có Zod schema riêng — test invalid payload reject

## Expected
- Migration không xoá/phá data
- Existing rows readable + writable
- Zod validate đúng cho mỗi pattern
- Invalid payload → ZodError

## Acceptance checklist
- [ ] 10 pre-migration rows readable sau migration
- [ ] 11 cột mới được thêm: `proposal_pattern`, `confidence`, `risk_score`, `risk_level`, `priority`, `timeout_hours`, `timeout_action`, `can_delegate`, `delegated_to_user_id`, `time_to_decision_seconds`, `metadata`
- [ ] Zod discriminatedUnion 4 pattern test
- [ ] Invalid payload throw ZodError
- [ ] Down migration (rollback) cũng test
- [ ] File `packages/shared/src/approvals/schemas.ts` exports Zod

## Implementation notes
**File:** `server/src/approvals/__tests__/approval-schema-adr0009.integration.test.ts`

**Helpers:**
- `seedPreADR0009Approvals(count)`
- `runMigration(name)`
- `validatePayload(pattern, payload)`

**Risk:**
- Per Completion eval: 7 cột còn thiếu trong impl. Test này cũng là implementation gate.
- Down migration: có thể không có script revert — cần thêm.

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
