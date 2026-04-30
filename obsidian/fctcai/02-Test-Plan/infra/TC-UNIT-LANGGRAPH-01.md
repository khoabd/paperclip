---
id: TC-UNIT-LANGGRAPH-01
name: LangGraph graph compilation + conditional edges routing
layer: unit
priority: P0
phases: [P2, ADR-0002]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-30
estimated_effort_hours: 3
---

# TC-UNIT-LANGGRAPH-01 — LangGraph compilation

## Mục tiêu
Verify LangGraph StateGraph cho mission orchestration biên dịch không lỗi và conditional edges routing đúng theo state.

## Pre-condition
- LangGraph package installed
- Mission graph definition file available

## Steps
1. Import graph builder, build StateGraph
2. Compile graph → verify no exception
3. Drive graph với 5 input states khác nhau (intake, planning, executing, reflecting, blocked)
4. Verify conditional edge routing: từ `executing` → `reflecting` khi steps done; → `blocked` khi failure
5. Verify all nodes reachable từ entry
6. Verify no infinite loops

## Expected
- Graph compile thành công
- 5 input states route đúng
- All nodes reachable
- No cycles trừ planned (re-plan loop)

## Acceptance checklist
- [ ] Graph compile không throw
- [ ] Test cả 5 input states
- [ ] Conditional edges đúng theo state machine spec
- [ ] Reachability verified (BFS từ entry)
- [ ] Cycle detection: chỉ cho phép re-plan loop (planning → executing → planning)
- [ ] Snapshot test cho graph topology

## Implementation notes
**File:** `server/src/platform/strategic-loop/__tests__/langgraph-compile.unit.test.ts`

**Helpers:**
- `buildMissionGraph()` — return compiled StateGraph
- `traceExecution(graph, inputState)` — drive graph và return path

**Risk:**
- LangGraph version compatibility — pin version
- Graph topology có thể chưa stable trong P4 — nếu thay đổi nhiều, test fragile

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
