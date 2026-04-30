# ADR-0008: Drag-In Detection — V1 Self-Report Only

**Status**: Accepted
**Date**: 2026-04-29

## Context

`Autonomy-Dial-and-Progressive-Trust-Design` defines the **drag-in tracker**: a metric that measures how often a workspace's automation pulls the human in mid-flow (vs. respecting batched/queued approvals). High drag-in indicates either:
- Autonomy dial set too low (over-gating)
- An agent that escalates too eagerly
- A capability that hasn't earned progressive trust yet

Detection options:
- A. **Programmatic detection** — compare `human_intervention_at` timestamps against the agent's last `awaitingApproval` event vs. the human's last interactive event in any tab. Requires presence detection across surfaces (web, CLI, MCP, mobile) and judgment on what counts as "interrupted".
- B. **Self-report** — when a human responds to an approval/notification, ask "did this interrupt focused work?" via a one-tap prompt (Yes / No / Snooze). Aggregate the Yes count.
- C. **Hybrid** — passive heuristic (e.g., "approval responded within 30s of arrival on a non-batched surface" = likely interrupt) plus a self-report override.

## Decision

**Option B — self-report only for V1.** When the user resolves an approval through any surface, the response card includes a single optional toggle: `Was this a drag-in? [Yes] [No]`. Default = unset (counted neither way).

Aggregations:
- Per workspace × week: `drag_in_count`, `non_drag_in_count`, `total_approvals_resolved`.
- Surfaced in the Autonomy dashboard alongside gate-quota burn-down.
- Used by the Efficiency Reviewer to recommend autonomy bumps when drag-in rate < 10% over 4 consecutive weeks for a capability.

## Rationale

- **Programmatic detection is hard and noisy.** Cross-surface presence (web focus, mobile foreground, CLI activity) is unreliable; false positives erode trust in the metric.
- **Self-report is honest signal.** The user knows whether it interrupted them; one tap is cheap.
- **Aligns with the bigger principle** — the human is the gate; let the human define what a drag-in is.
- **V1 ships fast.** We can add hybrid heuristics later without changing the storage shape (just feed an additional `auto_label` field).

## Consequences

- ✅ One small UI element across all approval surfaces (already the right place).
- ✅ Signal is high-quality from day one.
- ✅ Storage = one extra column on `approval_responses` (or, since paperclip stores responses inside `approvals.decision`, a `metadata.dragIn: boolean | null` field).
- ⚠️ Coverage depends on adoption; users who never tap it produce no signal. Mitigation: show the tracker in the dashboard with sample-size warnings ("based on 3/12 responses").
- ⚠️ Self-report bias possible (users may over- or under-report when annoyed). Acceptable for V1; revisit if dashboards look skewed.

## Future extension (V2 hybrid)

When V1 has 3+ months of self-report data, train a heuristic:
- Features: response_latency, surface, time_since_last_human_event, autonomy_level, capability.
- Target: self-reported `dragIn` label.
- Output: an `auto_drag_in_score` stored alongside the self-report.

If accuracy ≥ 0.85 vs. self-report on a hold-out, expose it as a passive estimate to fill in unanswered approvals. Self-report still wins when present.
