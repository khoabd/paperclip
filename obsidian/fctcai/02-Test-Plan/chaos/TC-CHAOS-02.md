---
id: TC-CHAOS-02
name: MCP cascade — GitLab MCP down
layer: chaos
priority: P0
phases: [P4, P6, P7]
status: draft
created: 2026-04-29
estimated_effort_hours: 6
---

# TC-CHAOS-02 — MCP cascade (GitLab MCP down)

## Mục tiêu
Verify circuit breaker kích hoạt khi GitLab MCP fail liên tục, escalate sau 10 phút, recover khi MCP back online.

## Pre-condition
- 5 missions active, depend trên GitLab MCP
- MCP health probe configured

## Steps
1. Simulate GitLab MCP timeout (mock return error liên tục)
2. Circuit breaker kích hoạt (sau 3 timeout)
3. MCP health probe (30s) verify broken status
4. Verify tất cả MR-related agents bị pause
5. Verify ephemeral env không spin up thêm
6. Sau 10 phút (simulated): escalate lên Approval Center
7. Restore GitLab MCP → circuit recover → agents resume

## Expected
- Circuit break < 30 giây sau cascade bắt đầu
- Escalation đúng sau 10 phút
- Không có data loss; agents resume từ checkpoint

## Acceptance checklist
- [ ] Circuit breaker state: closed → open sau 3 timeout
- [ ] `mcp_health_probes` row có status='broken'
- [ ] MR-related missions chuyển sang `paused_external_dependency`
- [ ] Sau 10 phút: `approval_items` row severity=HIGH cho MCP outage
- [ ] Restore: circuit breaker half-open → closed sau probe success
- [ ] Missions resume từ `paused_external_dependency` → previous state

## Implementation notes
**File:** `server/src/__tests__/chaos/mcp-cascade.chaos.test.ts`

**Helpers:**
- `mockMCPClient(behavior: 'healthy' | 'timeout' | 'half-broken')`
- `simulateClockSkip(minutes)` — `vi.useFakeTimers()`
- `assertCircuitBreakerState(expected)`

**Risk:**
- Cần MCP cascade rule thực sự được implement — currently chỉ là stub trong watchdog (note từ Quality eval).

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
