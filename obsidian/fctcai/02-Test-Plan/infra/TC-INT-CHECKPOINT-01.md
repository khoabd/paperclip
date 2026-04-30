---
id: TC-INT-CHECKPOINT-01
name: PostgreSQL checkpointer crash recovery
layer: integration
priority: P0
phases: [P2, ADR-0002]
status: implemented
test_file: server/src/platform/strategic-loop/__tests__/checkpointer-recovery.integration.test.ts
test_count: 4
note: Uses MemorySaver (BaseCheckpointSaver). Postgres saver (@langchain/langgraph-checkpoint-postgres) is a config-only swap once installed in ops.
created: 2026-04-30
estimated_effort_hours: 4
---

# TC-INT-CHECKPOINT-01 — Checkpointer crash recovery

## Mục tiêu
Verify khi mission crash giữa chừng, restart từ checkpoint khôi phục đúng state, không double-process.

## Pre-condition
- PostgreSQL MissionCheckpointer wired vào graph
- Embedded postgres test DB

## Steps
1. Start mission, drive graph qua 3 nodes (planning → executing → ...)
2. Simulate crash giữa node 4 (throw không catch)
3. Verify `mission_checkpoints` row có state sau node 3
4. Restart graph với cùng mission_id
5. Verify graph resume từ node 4 (không re-run node 1-3)
6. Drive graph đến done
7. Verify final state đúng

## Expected
- Checkpoint persist sau mỗi node
- Resume từ exact crash point
- No double-side-effects (idempotent)

## Acceptance checklist
- [ ] Checkpoint row có state JSONB sau mỗi node
- [ ] Resume skip nodes đã done
- [ ] Side effect tracking: count side-effect operations trước/sau crash + resume = 1 per side-effect
- [ ] Final state matches non-crash run
- [ ] Test với 3 crash points (giữa node 2, 4, 6)

## Implementation notes
**File:** `server/src/platform/strategic-loop/__tests__/checkpointer-recovery.integration.test.ts`

**Helpers:**
- `injectCrashAtNode(graph, nodeName)`
- `countSideEffects(missionId)` — query DB cho side-effect rows
- `assertResumeFromCheckpoint(missionId, expectedNode)`

**Risk:**
- LangGraph PostgreSQL checkpointer integration: cần verify package có support (`@langchain/langgraph-checkpoint-postgres`)
- Schema cho checkpoint table: cần migration

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
