---
id: TC-E2E-05
name: Rejection cascade — pattern học và auto-adjust
layer: e2e
priority: P1
phases: [P5, P9, P10]
status: draft
created: 2026-04-29
estimated_effort_hours: 6
---

# TC-E2E-05 — Rejection cascade

## Mục tiêu

Verify khi user reject ≥3 lần cùng category, DBSCAN cluster → learned_adjustments → inject vào agent prompt → effectiveness measurement → revert nếu kém.

## Phase liên quan

- P5 Intake (rejection nguồn)
- P9 Decision Boundary (trust impact)
- P10 Rejection (DBSCAN + adjustments)

## Pre-condition

- DB trống (zero rejection)
- Agent A configured với baseline prompt
- DBSCAN cron available

## Steps

1. Reject 5 approval_items cùng 1 agent A, category="wrong_estimate", trong 7 ngày
2. Nightly DBSCAN chạy (03:00 trigger)
3. Verify `cluster_id` được assign cho 5 events
4. Verify `learned_adjustments` được viết vào DB
5. Kiểm tra agent A prompt thay đổi ở next Strategic Loop
6. Gửi thêm 3 rejections sau adjustment (trong 30 ngày)
7. Verify `effectiveness measurement` chạy:
   - Nếu effectiveness < 0.3 → revert adjustment
   - Nếu recurrence ≥ 3 lần post-adjustment → "we-keep-failing-here" escalate

## Expected

- Cluster hình thành sau DBSCAN khi ≥ 3 rejections same category
- `learned_adjustments` inject vào agent prompt trước Sprint tiếp theo
- Effectiveness < 0.3 → revert; recurrence ≥3 → escalation

## Acceptance checklist

- [ ] `rejection_events` có 5 rows, cluster_id NULL trước DBSCAN
- [ ] Sau DBSCAN: 5 rows cùng cluster_id
- [ ] `learned_adjustments` row có `agent_id=A`, `adjustment_text` non-empty
- [ ] Agent A's next prompt evaluation contains adjustment text
- [ ] Sau 3 rejections post-adjustment: effectiveness score đo được
- [ ] Test 2 nhánh: effectiveness OK → keep, effectiveness < 0.3 → revert
- [ ] "We-keep-failing-here" escalate tạo approval HIGH

## Implementation notes

**File test:** `server/src/__tests__/e2e/rejection-cascade.e2e.test.ts`

**Helpers cần:**
- `seedRejectionEvents(agentId, category, count)`
- `runDBSCANClusterer()` — manual trigger
- `getAgentPromptVersion(agentId)` — verify prompt change
- `measureEffectiveness(adjustmentId)` — synthetic effectiveness

**Stubs:**
- LLM agent prompt evaluator (mock)
- Strategic Loop trigger

**Risk:**
- DBSCAN params (eps=0.25, minPoints=3) cần verify với realistic embeddings
- "Same category" definition: text similarity vs explicit category field

## Reviewer notes

> _Để trống_

## Status flow

- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
