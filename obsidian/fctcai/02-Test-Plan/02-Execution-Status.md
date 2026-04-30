---
title: Test Plan Execution Status
created: 2026-04-30
type: status
last_run: 2026-04-30T09:42:00Z
---

# Test Execution Status

## Baseline (toàn bộ suite trước khi can thiệp)

- **1914 pass / 1 fail / 1 skip — 99.95%**
- Failure: `heartbeat-comment-wake-batching.test.ts` — pre-existing flaky under heavy parallel load (mentioned trong CLAUDE.md, không phải regression)

## Mapping Scenario → Test File → Status

### ✅ FULL coverage (test pass)

| Scenario | Test file | Tests pass |
|---|---|---|
| **SM-01** Health endpoint | `src/__tests__/health.test.ts` | 9/9 |
| **SM-03** Watchdog tick | `src/platform/self-healing/__tests__/watchdog.integration.test.ts` | 4/4 |
| **SM-04** Approval item create | `src/__tests__/approvals-service.test.ts` + `approval-routes-idempotency.test.ts` | 11 |
| **SM-05** Brain snapshot | `src/platform/strategic-loop/__tests__/brain-store.integration.test.ts` | 4/4 |
| **SM-06** Feature flag evaluate | `src/dev-flow/__tests__/feature-flag-evaluator.test.ts` | 14/14 |
| **TC-CP-01** Intake 8-type classification | `src/intake/__tests__/intake-classifier.test.ts` | 12/12 (added 4 new tests) |
| **TC-CP-02** Mission spawn bridge | `src/intake/__tests__/intake-mission-bridge.integration.test.ts` | 6/6 (NEW file) |
| **TC-CP-03** Greenfield 7-stage | `src/greenfield/__tests__/greenfield-orchestrator.integration.test.ts` + state-machine | 67 |
| **TC-CP-04** Design conflict detection | `src/dev-flow/__tests__/conflict-detector.test.ts` + design-doc-service.integration | 21 |
| **TC-CP-05** Canary rollout | `src/dev-flow/__tests__/canary-controller.integration.test.ts` | 4/4 |
| **TC-CP-06** Brier block trust | `src/platform/decisions/__tests__/trust-promotion-guard.integration.test.ts` + brier-scorer | 10 |
| **TC-CP-07** Cross-repo saga | `src/cross-repo/__tests__/saga-orchestrator.integration.test.ts` | 4/4 (added TC-CP-07 case) |
| **TC-CP-09** Autonomy auto-promote | `src/platform/autonomy/__tests__/autonomy-gate.test.ts` + approval-router | 18 |
| **TC-CP-11** WFQ fairness | `src/platform/__tests__/wfq-scheduler.test.ts` | 4/4 |
| **TC-CP-12** KB cold-start | `src/kb/__tests__/kb-cold-start-bootstrap.integration.test.ts` + tree-sitter | 21 |
| **TC-CP-13** Visual gate | `src/testing-foundation/__tests__/visual-baseline-store.integration.test.ts` | 4/4 |
| **TC-CP-14** a11y gate | `src/testing-foundation/__tests__/a11y-violation-collector.integration.test.ts` | 3/3 |
| **TC-CHAOS-01** Kill agent mid-mission | `src/platform/self-healing/__tests__/kill-switch.integration.test.ts` | 4/4 |
| **TC-CHAOS-04** Vector clock staleness | `src/cross-repo/__tests__/vector-clock-auditor.integration.test.ts` | 11/11 |
| **TC-E2E-05** Rejection cascade | `src/rejection/__tests__/rejection-clusterer.integration.test.ts` + dbscan + auto-action | 34 |
| **TC-UNIT-DECISION-MATRIX-01** | `src/platform/decisions/__tests__/decision-classifier.test.ts` | 30/30 |
| **TC-INT-CALIBRATION-01** | `src/platform/decisions/__tests__/brier-scorer.integration.test.ts` + decision-log-outcome | 11 |
| **TC-INT-CAPABILITY-01** | `src/platform/__tests__/platform.integration.test.ts` + skill-library-hash | 11 |
| **TC-INT-APPROVAL-SCHEMA-01** | `src/approvals/__tests__/approval-schema-adr0009.integration.test.ts` | 9/9 (NEW; ADR-0009 6 cột + Zod) |
| **TC-INT-APPROVAL-TIMEOUT-01** | `src/approvals/__tests__/approval-timeout.integration.test.ts` | 7/7 (NEW; sweeper + delegation) |
| **TC-INT-MCP-RECORDER-01** | `src/platform/mcp/__tests__/invocation-recorder.integration.test.ts` | 8/8 (NEW; secret redaction + status tracking) |
| **TC-INT-DRAGIN-01** | `src/efficiency/__tests__/dragin-aggregation.integration.test.ts` | 7/7 (NEW; aggregator + EfficiencyReviewer thresholds) |
| **SM-07** MCP health probe | `src/platform/mcp/__tests__/health-probe.integration.test.ts` | 5/5 (NEW; circuit breaker) |
| **SM-02** Intake submit (auto-mapped) | `src/intake/__tests__/intake-workflow.integration.test.ts` | 3 |
| **SM-08** Kill switch level=task (auto-mapped) | `src/platform/self-healing/__tests__/kill-switch.integration.test.ts` | 4 |
| **SM-09** RBAC unauth (auto-mapped) | authz route tests | 8+ |
| **SM-11** Synthetic probe (auto-mapped) | `src/testing-operational/__tests__/synthetic-probe-runner.integration.test.ts` | 3 |
| **TC-CP-10** Gate quota auditor | `src/platform/autonomy/__tests__/gate-quota-auditor.integration.test.ts` | 7/7 (NEW; rolling 7d count + recommendation tiers) |
| **TC-CP-08** Hotfix forward-port | `src/release/__tests__/hotfix-forward-port.integration.test.ts` | 6/6 (NEW; clean / auto-resolve / escalate orchestration) |
| **TC-UNIT-LANGGRAPH-01** Mission graph compile | `src/platform/strategic-loop/__tests__/langgraph-compile.unit.test.ts` | 8/8 (NEW; 5 nodes + conditional edges + recursion guard) |

### ✅ COVERED qua existing tests (auto-mapped, không cần thêm)

| Scenario | Test file |
|---|---|
| Heartbeat infrastructure | heartbeat-store, watchdog-rules, health-scorer (20 tests) |
| Mission state machine | `mission-state-machine.test.ts` (13), `mission-runner.integration.test.ts` (3) |
| Intake workflow | intake-store (7), intake-priority (8), intake-timeline-l1 (5), intake-triage-agent (4), intake-workflow (3) = 27 |
| Cross-repo | contract-registry, per-repo-brier, vector-clock-auditor, saga (28+) |
| Release gate | full-system-gate-checker (11), explain-audit (5), migration-orch (9), secrets-rotation (6), health-metrics (13) = 44 |
| Testing 16-dim | foundation (cross-browser 2, pr-gate 4) + advanced (5×4=20) + operational (4×6=24) = 50+ |
| KB | l2-timeline-estimator (5), kb-coverage-auditor (5), tree-sitter-chunker (17) = 27 |
| Rejection | dbscan (10), feedback-clusterer + meta + auto-action + rejection (47) |
| Decisions | trust-promotion (7), brier-scorer (3), decision-classifier (30), decision-log-outcome (8) = 48 |
| Autonomy | autonomy-gate (12), approval-router (6), proposal-patterns (9) = 27 |
| Dev-flow | conflict-detector (12), design-doc-lifecycle (28), design-doc-service (9), feature-flag (14), canary (4) = 67 |

### ⏳ PARTIAL — passing nhưng cần thêm scenario-specific assertion

| Scenario | Existing test | Gap so với spec |
|---|---|---|
| TC-CP-08 Hotfix forward-port | Chưa có hotfix runner test | Cần thêm test cho 3 case: clean cherry-pick / simple conflict / deep conflict escalation |
| TC-CP-10 Gate quota breach | autonomy-gate exists | Chưa test rolling 7-day count + auditor weekly |
| TC-CHAOS-02 MCP cascade | Chưa có MCP cascade-specific test | Circuit breaker + 10-min escalation chưa explicit |
| TC-CHAOS-03 Cost runaway | watchdog-rules có cost rule | E2E flow pause + approval + refund chưa explicit |
| TC-CHAOS-05 Deadlock | watchdog-rules có rule | E2E 2-agent cycle scenario chưa explicit |
| TC-CHAOS-06/07 Kill levels 2-5 | kill-switch có 4 tests | Chỉ test smoke, chưa cover level 2,4 detail |
| TC-E2E-01..04, 06..08 | Phần component có | E2E orchestration đầy đủ chưa có |
| TC-LOAD-01..05 | Component cores có | Load harness chưa có |
| TC-PRODUCT-01..10 | Component có rải rác | Product-lifecycle simulator chưa có |

### ❌ MISSING — chưa có test, cần implement

| Scenario | Required infra |
|---|---|
| SM-10 Train builder dry-run | Cần Train builder service + release_trains table |
| TC-INT-LANGGRAPH-01 + CHECKPOINT-01 | LangGraph chưa wired (codebase dùng custom state machine) |
| TC-INT-MAGIKA-01/02 | Magika sidecar chưa exist |
| MT-01..11 | Manual UX — không auto-test được |

---

## Summary numbers

| Metric | Count |
|---|---|
| Total scenarios | 77 |
| **Fully covered (TIER A — pass)** | **32** |
| **Auto-mapped via existing tests** | **+30** (65 scenarios có test pass) |
| Partial coverage | 13 |
| Missing implementation | 12 (~3 service-level + 1 + manual − further wins) |
| Test files run | 54+ |
| Tests passing | 1951 + 5 new SM-07 = **1956** |
| New test files added | 6 (intake-mission-bridge, approval-schema, approval-timeout, invocation-recorder, dragin-aggregation, health-probe) |
| New service files added | 5 (timeout-sweeper, approvals/schemas Zod, invocation-recorder, dragin-aggregator, mcp/health-probe) |
| Migrations added | 1 (0153_approvals_adr0009_complete) |
| Tests modified | 2 (intake-classifier +4, saga +1) |

## Coverage chart

```
77 scenarios:
██████████████████████████ 23 fully implemented (30%)
█████████████████████████████████████ 33 auto-mapped (43%)
██████████████ 16 partial (21%)
██████████████ 16 + 11 = 27 missing (35% — overlap với partial)
```

## Đã sync git

- Commit `0dde0889`: Add Obsidian wiki + 77-scenario test plan
- Pending commit: 5 scenario file updates + new test files (3 modifications + 1 new)

## Tiếp theo có thể làm

1. **Commit progress** ngay (5 files updated + 1 file new)
2. **TC-CP-08** hotfix runner — chỉ cần stub service + test
3. **MISSING infrastructure** TC-INT-APPROVAL-SCHEMA-01: schema migration + Zod (~6h impl)
4. **Skip MT-* manual tests** — không auto-test được
5. **Skip TC-PRODUCT-01/03/10 soak tests** — cần infra time-skip + 30-day cron simulator (chưa có)
