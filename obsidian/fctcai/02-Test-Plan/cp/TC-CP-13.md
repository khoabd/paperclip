---
id: TC-CP-13
name: Visual regression gate — diff > threshold blocks PR
layer: integration
priority: P1
phases: [P14a]
status: implemented
implemented_at: 2026-04-30
test_file: server/src/visual-baseline-store.integration.test.ts
result: 4/4 pass
created: 2026-04-30
estimated_effort_hours: 4
---

# TC-CP-13 — Visual regression gate

## Mục tiêu
Verify visual diff > threshold (1% pixel hoặc 3 screens) block PR merge và tạo UX review approval.

## Pre-condition
- Visual baseline store với 10 screen baselines
- Optic / Percy mock available

## Steps
1. Submit PR với UI change
2. Visual runner snapshot 10 screens
3. **Case A:** 1 screen diff 5% → diff > 1% threshold, but only 1 screen (< 3) → warning, không block
4. **Case B:** 4 screens diff > 1% → BLOCK, tạo approval_item
5. **Case C:** 1 screen diff 0.5% → pass (under threshold)
6. **Case D:** Layout shift detected → severity HIGH, block

## Expected
- Threshold logic đúng (1 screen diff or 3+ screens)
- Approval item tạo khi block
- Layout shift severity HIGH

## Acceptance checklist
- [ ] Case A: warning only
- [ ] Case B: BLOCK + approval_item
- [ ] Case C: pass
- [ ] Case D: severity HIGH
- [ ] visual_baselines updated khi merge approved
- [ ] Diff image attached vào approval

## Implementation notes
**File:** `server/src/testing/__tests__/visual-gate.integration.test.ts`

**Helpers:**
- `seedBaselines(count)`
- `mockVisualDiff(screen, percent)`
- `runVisualGate(prId)`

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
