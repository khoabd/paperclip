---
id: TC-UNIT-DECISION-MATRIX-01
name: Decision Boundary 3×3 matrix + uncertainty override
layer: unit
priority: P0
phases: [P9]
status: draft
created: 2026-04-30
estimated_effort_hours: 3
---

# TC-UNIT-DECISION-MATRIX-01 — Decision Boundary matrix

## Mục tiêu
Verify decision boundary matrix (Reversibility × Blast Radius × Uncertainty) trả về đúng action: auto / gate / escalate.

## Pre-condition
- DecisionBoundaryEvaluator class available
- Matrix config từ design `Decision-Boundary-and-Uncertainty-Model.md §2`

## Steps
Test all 9 cells của matrix 3×3:
1. Reversible × Local — auto (low uncertainty), gate (medium), escalate (high uncertainty > threshold)
2. Reversible × Workspace — gate / gate / escalate
3. Reversible × Global — gate / escalate / escalate
4. Hard-to-reverse × Local — gate / gate / escalate
5. Hard-to-reverse × Workspace — gate / escalate / escalate
6. Hard-to-reverse × Global — escalate × 3
7. Irreversible × Local — gate / escalate / escalate
8. Irreversible × Workspace — escalate × 3
9. Irreversible × Global — escalate × 3

## Expected
- Mỗi cell trả về action đúng theo spec
- Uncertainty threshold (0.4) override cell default
- Edge: uncertainty exactly = 0.4 → boundary check

## Acceptance checklist
- [ ] All 9 cells × 3 uncertainty levels = 27 test cases
- [ ] Boundary at 0.4 tested explicitly
- [ ] Pure function (no DB)
- [ ] Snapshot test cho matrix output
- [ ] Negative: invalid input throws

## Implementation notes
**File:** `server/src/platform/decisions/__tests__/decision-matrix.unit.test.ts`

**Helpers:**
- `evalCell(reversibility, blast, uncertainty)`
- Table-driven test với 27 rows

**Risk:**
- Matrix có thể chưa được implement (per Gap analysis #7) — test này cũng là implementation gate

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
