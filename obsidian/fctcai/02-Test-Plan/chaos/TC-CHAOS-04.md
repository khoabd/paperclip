---
id: TC-CHAOS-04
name: Brain-store corruption — vector clock stale
layer: chaos
priority: P1
phases: [P12]
status: draft
created: 2026-04-29
estimated_effort_hours: 5
---

# TC-CHAOS-04 — Vector clock staleness

## Mục tiêu
Verify vector clock auditor detect agent đọc snapshot cũ và reject writes dựa trên stale data.

## Pre-condition
- 3 agents đang đọc `brain_snapshot` cùng giờ
- Vector clock được set

## Steps
1. Agent A viết `brain_snapshot` mới (timestamp T)
2. Agent B và C vẫn đang đọc snapshot cũ (T-2h)
3. Vector clock staleness audit (2h cron) chạy
4. Verify B và C được flag là stale
5. Verify B và C không được phép viết decision dựa trên snapshot cũ

## Expected
- Staleness flag trong < 2h
- Writes bị reject với explicit error
- Audit log ghi rõ agent_id + staleness duration

## Acceptance checklist
- [ ] vector_clocks rows: 3 agents
- [ ] Sau audit: B và C có `is_stale = true`
- [ ] Decision write từ B/C throws StaleSnapshotError
- [ ] Audit log entry có agent_id + duration
- [ ] Sau B/C re-fetch snapshot mới: writes OK trở lại

## Implementation notes
**File:** `server/src/cross-repo/__tests__/vector-clock-staleness.chaos.test.ts`

**Helpers:**
- `seedVectorClock(agentId, snapshotVersion)`
- `runStalenessAudit()`
- `assertWriteRejected(agentId, expectedError)`

**Risk:**
- Vector clock implementation trong P12 có integrate với write path không? (note từ Business eval: "vector clocks tồn tại nhưng không thấy tích hợp với saga")
- Cần verify integration trước khi viết test

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
