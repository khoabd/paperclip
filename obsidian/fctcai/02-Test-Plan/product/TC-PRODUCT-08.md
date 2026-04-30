---
id: TC-PRODUCT-08
name: Workspace lifecycle — archive + delete + data cleanup
layer: e2e
priority: P2
phases: [P3, P15]
status: draft
created: 2026-04-30
estimated_effort_hours: 5
---

# TC-PRODUCT-08 — Workspace lifecycle

## Mục tiêu
Verify lifecycle workspace: archive (read-only) → delete (cleanup) — không orphan, audit log preserved, export accessible.

## Pre-condition
- Workspace với 6 months data:
    - 30 missions completed
    - 200 cost_events
    - 1000 decision_log entries
    - 50 brain revisions
    - 100 approval_items
- Founder confirm "archive product"

## Steps

### Archive
1. Founder action: archive workspace
2. Verify workspace_lifecycle_events row "ARCHIVED"
3. Verify workspace status='archived'
4. Verify all workspace's data read-only:
    - INSERT vào missions throws
    - UPDATE existing missions throws
5. Verify cron jobs skip archived workspace (watchdog, brier, etc.)
6. Verify export endpoint return all data dạng JSON

### Re-activate
7. Founder action: re-activate within 30 days
8. Verify workspace status='active', data intact

### Delete (after archive)
9. Day 31: Founder action: delete workspace
10. Verify confirmation flow (double-confirm + 7-day cooling-off)
11. Day 38: Actual deletion runs
12. Verify cascade delete:
    - missions → mission_steps → cost_events
    - brain documents → revisions
    - approval_items
    - decision_log... (some may be retained for audit)
13. Verify audit log preserved (workspace_lifecycle_events kept forever)

### Post-delete
14. Verify export still accessible 7 days after delete (compliance)
15. Verify FK constraints không broken (other workspaces unaffected)

## Expected
- Archive: read-only, jobs skip
- Re-activate: data intact
- Delete: cascade cleanup, audit preserved, export accessible
- Cooling-off period enforced

## Acceptance checklist
- [ ] Archive: workspace status='archived'
- [ ] INSERT/UPDATE workspace data throws
- [ ] Cron skip archived (verify by tick + assert no operations)
- [ ] Export JSON có all entities
- [ ] Re-activate: status='active', queries work
- [ ] Delete: 7-day cooling-off enforced
- [ ] Cascade: missions, cost_events, brain... deleted
- [ ] Audit preserved: workspace_lifecycle_events still queryable
- [ ] Export window 7 days post-delete
- [ ] No orphan rows in any other table

## Implementation notes

**File:** `server/src/__tests__/product/workspace-lifecycle.e2e.test.ts`

**Helpers:**
- `seedMatureWorkspace(monthsOfData)`
- `archiveWorkspace(id)` / `reactivateWorkspace(id)` / `deleteWorkspace(id)`
- `assertCascadeDelete(workspaceId)` — query all tables, expect 0 rows for ID
- `assertAuditPreserved(workspaceId)`

**Risk:**
- ARCHIVE state chưa exist trong companies schema (chỉ có status active/inactive). Cần thêm.
- Cooling-off period: cần job để actual deletion sau 7 days. Schedule job needs design.
- GDPR / compliance: delete có thực sự cascade? — cần verify.

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
