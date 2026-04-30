---
id: TC-PRODUCT-01
name: 90-day simulated single-product lifecycle (NORTH STAR)
layer: e2e-soak
priority: P0
phases: [P5, P7, P8, P9, P11, P13, P14a, P15]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-30
estimated_effort_hours: 30
---

# TC-PRODUCT-01 — 90-day single-product lifecycle (NORTH STAR)

## Mục tiêu
**Test đỉnh cao** — chứng minh hệ thống có thể ship 1 product từ 0 đến 5 features live trong 90 ngày, với founder spending ≤ 12.5h/week.

## Pre-condition
- Test environment với time-skip helper (`vi.useFakeTimers` + custom orchestrator)
- All 16 phase services wired (cron jobs scheduled)
- Mock GitLab MCP, OpenSearch MCP, embedding model
- Greenfield intake fixtures

## Steps

### Day 0-7: Greenfield Bootstrap
1. Founder submit greenfield intake: "Build gym tracker SaaS"
2. 7-stage greenfield runs: idea_refinement → market_research → personas → stack → brain → repo_scaffold → sprint1
3. Verify Sprint 1 mission spawned at end of Day 7

### Day 8-30: Feature 1 + 2
4. Sprint 1 executes: 5 tasks, 1 PR per task
5. Verify Feature 1 ships to live by Day 21 (canary 5/25/50/100)
6. Sprint 2 starts Day 22, ships Feature 2 by Day 35
7. Outcome tracker T+7 fires for Feature 1 on Day 28

### Day 31-60: Iteration + Feedback
8. Customer feedback intake submitted Day 35 (mock signals from product_signals table)
9. Strategic Loop Mon Day 38: re-prioritize sprint based on feedback
10. Feature 3 (driven by feedback) ships Day 50
11. Brier calibration nightly cron runs all 60 days
12. Verify Brier < 0.15 maintained

### Day 61-90: Maturity
13. Features 4 + 5 ship Day 65, Day 80
14. Auto-promote at least 1 capability from `gate` → `auto`
15. Outcome tracker for Features 1-5 all complete by Day 90

### Day 90: Acceptance measurement
16. Aggregate metrics:
    - Total founder human-active time (sum of approval response times + drag-in events)
    - Number of gates/week per product
    - Brier score final
    - Total cost (USD)
    - Mission success rate

## Expected

- **5 features shipped to env/live** trong 90 ngày
- **Founder time ≤ 12.5h/week** (≤ 160h tổng cho 90 ngày)
- **Gates/project/week ≤ 8** average
- **Brier final < 0.15**
- **Total cost < $X** (configurable threshold, e.g. $500)
- **0 data corruption** (decision_log, brain, mission_steps consistent)

## Acceptance checklist

- [ ] 5 missions hoàn thành status='done'
- [ ] 5 outcome_tracker rows với T+7 measurement
- [ ] Sum approval response times ≤ 160h
- [ ] Average gates/week per active product ≤ 8
- [ ] brier_calibration final row score < 0.15
- [ ] Total cost_events sum < threshold
- [ ] No `state_corruption` events in stuck_events
- [ ] Brain revisions linear (no fork/conflict)
- [ ] At least 1 capability_promotion_events row
- [ ] Decision_log có entry cho mỗi state transition (audit complete)
- [ ] Memory heap không grow > 100MB
- [ ] DB row counts trong threshold (cost_events < 100k, decision_log < 50k)

## Implementation notes

**File:** `server/src/__tests__/product/single-product-90-day.soak.test.ts`

**Critical helpers:**
- `simulateDays(days, options)` — fast-forward + run all crons in order
- `productionSimulator(workspace)` — orchestrate end-to-end
- `assertNorthStarMetrics(workspace, thresholds)`
- `mockCustomerSignals(workspace, day, signals)`

**Time-skip strategy:**
- Use `vi.useFakeTimers()` + `vi.advanceTimersByTime()` for cron scheduling
- BUT: actual mission execution runs real-time (state machine ticks)
- Alternative: build a `ClockController` service that all timestamps go through, allowing test to advance virtually

**Risk:**
- Test có thể chạy 30+ phút real wall-clock → run as nightly soak job, not per-PR
- Mock fidelity: nếu mock embedding/LLM quá đơn giản, kết quả không representative
- Flakiness: 90-day simulation có thể có race condition tích lũy → cần seed deterministic

**Why P0:** Đây là test duy nhất chứng minh "founder ship được product autonomous". Nếu không có test này, mọi claim production-ready là giả định.

## Reviewer notes
> _Để trống — đây là test KHÓ NHẤT nhưng QUAN TRỌNG NHẤT_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
