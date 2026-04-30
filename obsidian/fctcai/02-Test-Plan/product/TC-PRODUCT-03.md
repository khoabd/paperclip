---
id: TC-PRODUCT-03
name: Founder absence test (7 ngày, 30 ngày)
layer: chaos-soak
priority: P0
phases: [P3, P6, P9, P15]
status: implemented
test_file: server/src/platform/simulator/__tests__/product-lifecycle.simulator.test.ts
note: Covered by ProductLifecycleSimulator (server/src/platform/simulator/product-lifecycle.ts) which stitches workspaces/missions/gates/brain/budgets/sagas into a deterministic state machine. Real production services remain authoritative; the simulator is the test harness.
created: 2026-04-30
estimated_effort_hours: 10
---

# TC-PRODUCT-03 — Founder absence

## Mục tiêu
Verify hệ thống vận hành an toàn khi founder vắng 7 ngày → 30 ngày, không có catastrophic action, batch escalations đúng, recover khi quay lại.

## Pre-condition
- 1 workspace với 3 active missions
- Notification dispatcher mock (capture mọi outbound)
- Approval timeouts configured

## Steps

### Pre-absence baseline
1. Founder approve 5 items, set `away_mode='vacation'` Day 0

### Absence 7 days
2. Day 1-7: 20 approval_items được tạo với mix risk:
    - 10 LOW (auto-approve eligible)
    - 7 MEDIUM (timeout 4h → auto-defer)
    - 3 HIGH (timeout 1h → escalate)
3. Verify hệ thống:
    - 10 LOW auto-approved
    - 7 MEDIUM defer (status='deferred', không die)
    - 3 HIGH escalate qua secondary channel (PagerDuty mock)
4. Day 7: Founder quay lại
5. Verify Approval Center có batch summary "while you were away"

### Absence 30 days (extended)
6. Tiếp tục 30-day absence từ Day 8
7. Verify batched notifications (không spam — gửi digest mỗi 3 ngày)
8. Verify critical kill events vẫn fire (mission cost runaway, kill level 4)
9. Verify watchdog tự động pause workspace nếu HIGH approvals tích tụ > 5

### Adverse during absence
10. Inject cost runaway Day 15 → verify auto-pause + escalate (không auto-kill)
11. Inject MCP cascade Day 20 → verify circuit breaker hoạt động + retry sau MCP recover

### Recovery
12. Day 31: Founder quay lại
13. Verify summary report: "30 days summary"
14. Verify all paused missions có rõ root cause + recovery suggestion

## Expected
- 7-day absence: hệ thống "graceful degradation", không die
- 30-day absence: deeper safeguards (auto-pause critical, batch notify)
- Cost cap không bị bypass dù vắng lâu
- Recovery: clear summary + actionable next steps

## Acceptance checklist
- [ ] 10 LOW auto-approve rows
- [ ] 7 MEDIUM status='deferred', không die
- [ ] 3 HIGH có escalation event row
- [ ] PagerDuty mock fire ≥ 3 lần (chỉ HIGH)
- [ ] Day 7 summary email có đủ 20 items
- [ ] 30-day: notifications batched (1 digest/3 days = ~10 digests, không phải 30)
- [ ] Cost runaway Day 15: auto-pause, không auto-kill
- [ ] MCP cascade Day 20: circuit breaker fire, retry on recover
- [ ] Day 31 summary có actionable items
- [ ] Total founder critical alerts ≤ 5 (không spam)

## Implementation notes

**File:** `server/src/__tests__/product/founder-absence.chaos.test.ts`

**Helpers:**
- `setAwayMode(userId, durationDays)`
- `injectApprovals(workspaceId, riskMix, period)`
- `simulateAbsence(days)` — combine time-skip + assertion flow
- `assertNoCatastrophicAction(workspaceId)` — query for kill level >= 4 events

**Critical assumption:**
- Notification dispatcher PHẢI exist (per Business eval: chưa có). Test này cũng là spec/gate cho việc xây dispatcher.
- "Away mode" cần feature flag — chưa có trong design hiện tại. Cần thêm vào ADR nếu chưa có.

**Risk:**
- 30-day simulation tốn time → run nightly only
- Distinguish "graceful degradation" vs "system died silently" — cần có heartbeat của hệ thống tổng thể, không chỉ agent

## Reviewer notes
> _Để trống — đây là test cho giả định cốt lõi của design "founder vắng vẫn an toàn"_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
