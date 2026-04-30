---
id: TC-E2E-04
name: Per-Incident Response — log spike đến auto-rollback
layer: e2e
priority: P0
phases: [P6, P7, P13, P15]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-29
estimated_effort_hours: 6
---

# TC-E2E-04 — Per-Incident Response

## Mục tiêu

Verify khi production có error spike, hệ thống detect → pause canary → tạo approval HIGH → human approve → auto-rollback hoàn tất.

## Phase liên quan

- P6 Self-Healing — watchdog & alert evaluator
- P7 Dev Flow — canary controller
- P13 Release Train — rollback executor
- P15 Release Hardening — incident handler + post-mortem auto-draft

## Pre-condition

- Production có canary đang chạy ở 25%
- OpenSearch alert rule configured (threshold: error_rate > 5%)
- Approval Center mocked với auto-approve programable

## Steps

1. Inject error spike vào prod logs (>5% error rate)
2. Alert evaluator (60s cron) detect alert_rule breach
3. Incident Handler wake — correlate với canary đang active
4. Auto-pause canary tại 25% (không advance tiếp)
5. Approval Center tạo item HIGH risk (80–95), timeout 1h
6. Human approve "rollback"
7. GitLab MCP execute rollback (revert merge + redeploy previous tag)
8. Verify post-mortem được auto-draft

## Expected

- Alert fire trong < 90 giây từ error spike inject
- Rollback hoàn thành trong 60 giây sau approval
- `kill_events` hoặc `rollback_events` được log
- Post-mortem document tạo với key=`postmortem/<incident_id>`

## Acceptance checklist

- [ ] `alert_evaluations` row có `triggered_at` ≤ 90s sau inject
- [ ] `canary_runs.status = 'paused'` ngay sau alert
- [ ] `approval_items` row có severity=HIGH, risk_score 80–95
- [ ] Sau approve: `rollback_events` row có `executed_at`
- [ ] `documents` row với key=`postmortem/<id>` tồn tại với body chứa timeline
- [ ] Total time alert→rollback < 5 phút (simulated)
- [ ] Decision log có chuỗi đầy đủ: detect → pause → approve → rollback

## Implementation notes

**File test:** `server/src/__tests__/e2e/incident-response.e2e.test.ts`

**Helpers cần:**
- `injectErrorSpike(rate)` — push fake log events vào OpenSearch mock
- `assertCanaryPaused()` — check status + rollout_percent không tăng
- `runRollbackFlow()` — orchestrate end-to-end

**Stubs:**
- OpenSearch query mock
- GitLab MCP `revert` + `redeploy` ops
- Slack/email notification capture

**Risk:**
- Cần xác định ai gọi `IncidentHandler` (cron poll vs push?)
- Post-mortem auto-draft phụ thuộc LLM → mock LLM response

## Reviewer notes

> _Để trống_

## Status flow

- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
