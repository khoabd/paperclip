---
id: TC-E2E-06
name: Self-Heal cascade — agent stuck, watchdog detect, recover hoặc escalate
layer: e2e
priority: P0
phases: [P6]
status: implemented
test_file: server/src/platform/e2e-orchestrator/__tests__/e2e-scenarios.test.ts
note: Covered by an in-process E2E orchestration harness composing the same primitives the production stack exposes (intake → mission → review → release). UI/browser flow stays out of scope; the orchestration contract is what we verify.
created: 2026-04-29
estimated_effort_hours: 5
---

# TC-E2E-06 — Self-Heal cascade

## Mục tiêu

Verify watchdog phát hiện agent silent → ping recovery → escalate kill-switch → human approve kill → budget refund.

## Phase liên quan

- P6 Self-Healing (toàn bộ)

## Pre-condition

- 1 active mission đang running
- Watchdog cron enabled (60s tick)
- Heartbeat store trống (sẽ seed)

## Steps

1. Giả lập agent im lặng (không emit heartbeat) > 5 phút
2. Watchdog tick phát hiện stalled
3. Watchdog ping agent (mock không reply), chờ 2 phút
4. Nếu không phục hồi: tạo `stuck_event`, `approval_item` HIGH risk
5. Human chọn "kill"
6. Verify `kill_event` được log; budget refund được ghi
7. Verify `workflow_health.composite_state = 'stuck'` rồi → 'failed'

## Expected

- Toàn bộ luồng từ silent đến escalation < 8 phút
- `kill_switch_events` được tạo với level đúng (level 2 cho mission-kill)
- Unused budget được trả lại project (`budget_incidents` có refund row)

## Acceptance checklist

- [ ] `liveness_heartbeats` không có row mới sau timestamp cutoff
- [ ] `stuck_events` row tạo với `detected_at` ≤ 6 phút sau cutoff
- [ ] `approval_items` row severity=HIGH cho kill request
- [ ] Sau approve: `kill_switch_events` có level=2
- [ ] `workflow_health` row có sequence: running → stuck → failed
- [ ] `budget_incidents` có refund row với `amount > 0`
- [ ] Mission status final = `killed`

## Implementation notes

**File test:** `server/src/platform/self-healing/__tests__/self-heal-cascade.e2e.test.ts`

**Helpers cần:**
- `silenceAgent(agentId, durationMs)` — stop heartbeat emission
- `runWatchdogTicks(count)` — manual ticks
- `mockApprovalDecision(action)` — programmatic approve

**Stubs:**
- Agent ping responder (configurable: alive | dead)
- Budget refund calculator

**Risk:**
- Timing-sensitive — phải dùng `vi.useFakeTimers()` strict
- "ping agent" mechanism cần định nghĩa rõ trong P6 (RPC? message bus?)

## Reviewer notes

> _Để trống_

## Status flow

- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
