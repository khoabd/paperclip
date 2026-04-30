---
id: TC-CP-14
name: a11y axe-core gate — critical/serious blocks PR
layer: integration
priority: P1
phases: [P14a]
status: draft
created: 2026-04-30
estimated_effort_hours: 3
---

# TC-CP-14 — a11y gate

## Mục tiêu
Verify a11y violations severity 'critical' hoặc 'serious' block PR merge.

## Pre-condition
- axe-core integration
- a11y_violations table

## Steps
1. Submit PR với UI change
2. axe-core scan tất cả pages trong storybook
3. **Case A:** 0 violations → pass
4. **Case B:** 5 minor violations → pass with warning
5. **Case C:** 1 critical violation → BLOCK
6. **Case D:** 3 serious violations → BLOCK
7. Verify approval_item tạo cho block cases

## Expected
- minor → pass
- critical/serious → block
- Approval item có violation details

## Acceptance checklist
- [ ] Case A: pass
- [ ] Case B: pass + warning
- [ ] Case C: BLOCK + approval (critical)
- [ ] Case D: BLOCK + approval (serious)
- [ ] a11y_violations rows persist
- [ ] WCAG level annotated (AA, AAA)

## Implementation notes
**File:** `server/src/testing/__tests__/a11y-gate.integration.test.ts`

**Helpers:**
- `mockAxeResults(violations)`
- `runA11yGate(prId)`

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
