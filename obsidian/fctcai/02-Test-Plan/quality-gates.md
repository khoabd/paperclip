---
id: quality-gates
title: Quality Gates cho Release Train
status: draft
created: 2026-04-29
---

# Quality Gates — Release Train

## Block Conditions

| Condition | Action |
|-----------|--------|
| Bất kỳ TC P0 nào fail | **Hard block** — không được promote env/stag hoặc env/live |
| Brier score > 0.15 (bất kỳ agent) | Block trust promotion; yêu cầu human review agent log |
| E2E smoke set có ≥ 1 fail | Block auto-promote; require manual approval trước promote |
| a11y violation severity 'critical' hoặc 'serious' | Block PR merge (Phase 14a gate) |
| Visual regression diff > threshold trên > 3 screens | Block PR merge, tạo UX review approval_item |
| Canary error rate > 1% tại bất kỳ stage | Auto-pause canary, require human approve để continue |
| Saga compensation fail (partial rollback) | Hard block deploy, immediate escalation P0 |
| Test coverage regression > 5% | Warning; block nếu là module P0 (intake, self-healing, greenfield) |

## Soak Window

| Environment | Soak requirement |
|-------------|-----------------|
| env/stag | Tối thiểu 24h (Full-System Gate criterion #7) |
| env/live (canary) | 5% trong 30 phút, 25% trong 1h, 50% cho đến khi approved, 100% production |
| Post-live | Outcome tracker T+7 phải chạy và không có regression trước khi đóng train |

## Rollback Triggers

- Error rate prod > 1% trong cửa sổ 5 phút: **auto-rollback** (không cần approval nếu uncertainty < 0.2)
- Error rate prod > 0.5% kéo dài > 15 phút: tạo approval_item HIGH risk, 1h timeout
- `synthetic_probe_results` fail ≥ 2 liên tiếp (5-phút cron): auto-pause canary hoặc rollback
- Kill switch level ≥ 4 được kích hoạt: immediate full-stop, alert on-call, không auto-resume
- Brier drift > 0.05 trên 24h: notify on-call, defer next train đến khi có root cause

## Bảng tổng hợp gate cho mỗi env transition

| Transition | Required gates | Optional gates |
|---|---|---|
| dev → stag | All P0 unit + integration pass; PR Gate green | Visual diff < threshold; a11y pass |
| stag → canary 5% | 24h soak; smoke 10/10 pass; Brier < 0.15 | Manual sanity check |
| canary 5 → 25 | 30min metrics OK; error rate < 1% | UX heuristic score ≥ 8/10 |
| canary 25 → 50 | 1h metrics OK | Approval (HIGH risk) |
| canary 50 → 100 | Approval mandatory | Outcome tracker baseline |
| 100 → done | T+7 outcome tracker complete | Brier delta < 0.05 |

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
