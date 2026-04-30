---
id: TC-PRODUCT-10
name: 30/60/90-day soak stability test
layer: soak
priority: P1
phases: [all]
status: draft
created: 2026-04-30
estimated_effort_hours: 20
---

# TC-PRODUCT-10 — Long-running soak stability

## Mục tiêu
Verify hệ thống ổn định qua 30/60/90 ngày: không memory leak, DB không phình quá ngưỡng, Brier không drift, cron state không tích lũy bất thường.

## Pre-condition
- Single workspace với realistic activity load
- Heap snapshot tooling enabled
- DB row count tracking
- Time-skip infrastructure

## Steps

### Day 0 baseline
1. Snapshot heap, DB row counts, cron last_run timestamps
2. Workspace có 1 active mission

### Day 1-30: Light load
3. Daily activity: 5 approvals, 1 mission complete, 50 cost_events
4. Verify daily:
    - Heap delta ≤ 5MB/day
    - DB rows: cost_events + 50/day, decision_log + 100/day
    - Cron jobs all run on schedule
5. Day 30 checkpoint: aggregate stability metrics

### Day 31-60: Medium load
6. Increase activity 2x
7. Verify scaling linear, not super-linear
8. Verify no slowdown in critical paths (watchdog tick, intake triage)

### Day 61-90: Stress + recover
9. Day 70: Inject 1 chaos event (cost runaway)
10. Verify recovery, no memory bump permanent
11. Day 80: Inject MCP cascade
12. Day 90: Final checkpoint

### Drift checks
13. Brier score: compare Day 30 vs Day 90 — drift ≤ 0.05
14. Decision matrix calibration: monitor offset stability
15. WFQ virtual time: verify rotation, no overflow

### Memory + DB
16. Heap profile: identify any leak (objects retained không justified)
17. DB index health: verify queries < threshold latency
18. Brain document size: verify pruning hoặc growth controlled

## Expected
- Memory stable across 90 days
- DB growth predictable (cost_events linear, brain controlled)
- Brier drift ≤ 0.05
- Cron jobs reliable (no missed ticks)
- Recovery from chaos events restores baseline

## Acceptance checklist
- [ ] Heap delta Day 0 → Day 90 ≤ 200MB
- [ ] cost_events rows ≤ 5000 (daily ≤ 55 average)
- [ ] decision_log rows ≤ 10000
- [ ] brain document body ≤ 200KB OR pruning fired
- [ ] Brier Day 90 vs Day 30: |delta| ≤ 0.05
- [ ] Cron `nightly_calibration` ran 90/90 nights (no skip)
- [ ] Watchdog tick latency p99 ≤ 1s xuyên suốt
- [ ] No deadlocks logged
- [ ] No memory leak indicators (RSS stable)
- [ ] Index queries `EXPLAIN` planner unchanged structure

## Implementation notes

**File:** `server/src/__tests__/product/soak-90-day.soak.test.ts`

**Helpers:**
- `seedDailyActivity(workspaceId, day, profile)`
- `snapshotMemoryAndDB(workspaceId)`
- `assertNoMemoryLeak(snapshots)`
- `measureCronReliability(periodDays)`
- `pruneBrain(workspaceId)` — if needed

**Strategy:**
- Run as nightly soak job, not per-PR
- Use Docker compose with persistent storage để stress real DB (not embedded)
- Có thể split: 30-day quick, 90-day weekly

**Risk:**
- 90-day simulation rất tốn — cần infra riêng (CI mins, RAM)
- Mock fidelity: nếu LLM mock không vary, Brier stay constant — không real test
- Brain pruning logic chưa được implement (per code review) — test có thể fail expose bug

## Reviewer notes
> _Để trống — đây là test infrastructure-heavy nhất_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
