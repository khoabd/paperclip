---
title: FCTCAI Test Plan Hub
created: 2026-04-29
status: draft
type: hub
scope: Full-System Gate (Phase 15 cumulative)
---

# FCTCAI / Custom Paperclip — Test Plan

Hub điều hướng các kịch bản kiểm thử bổ sung. Mỗi kịch bản là 1 file riêng để review độc lập trước khi implement.

## Trạng thái pyramid hiện tại

| Layer | Số lượng (ước tính) | Ghi chú |
|---|---|---|
| Unit | ~180 | Rules, state machines, classifiers, evaluators |
| Integration (embedded Postgres) | ~90 | Stores + orchestrators + service integration |
| E2E / system | 1 (`routines-e2e.test.ts`) | Rất mỏng |
| Chaos / load / perf | 0 | Hoàn toàn trống |

**Tổng:** 277 file `.test.ts`, 1910/1912 test pass.

## Coverage gap

- E2E: chỉ 1 file — 6 flow trong `Full-System-Workflow-and-Coordination` chưa có E2E tương ứng
- Greenfield: chỉ 2 file test — thiếu recovery sau stage failure
- Cross-phase: chưa có pipeline `intake → mission → approval → deploy`
- Chaos / load: hoàn toàn trống — rủi ro lớn nhất trước Full-System Gate
- `intake-mission-bridge.ts` chỉ cover gián tiếp

---

## Danh mục kịch bản

### Product Lifecycle / Multi-Product (10 — NEW NORTH STAR) — `product/`

Test khả năng vận hành 1 sản phẩm hoặc đa sản phẩm thực tế.

| ID | Tên | Priority | Layer |
|---|---|---|---|
| [[product/TC-PRODUCT-01\|TC-PRODUCT-01]] | **NORTH STAR** 90-day single-product lifecycle | P0 | e2e-soak |
| [[product/TC-PRODUCT-02\|TC-PRODUCT-02]] | Multi-product 3 workspaces concurrent | P0 | e2e |
| [[product/TC-PRODUCT-03\|TC-PRODUCT-03]] | Founder absence (7d, 30d) | P0 | chaos-soak |
| [[product/TC-PRODUCT-04\|TC-PRODUCT-04]] | Product pivot mid-flight | P1 | e2e |
| [[product/TC-PRODUCT-05\|TC-PRODUCT-05]] | Onboard new product khi đang busy | P1 | e2e |
| [[product/TC-PRODUCT-06\|TC-PRODUCT-06]] | Cross-product budget reallocation | P1 | chaos-e2e |
| [[product/TC-PRODUCT-07\|TC-PRODUCT-07]] | Cross-product regression cascade | P1 | chaos |
| [[product/TC-PRODUCT-08\|TC-PRODUCT-08]] | Workspace archive + delete + cleanup | P2 | e2e |
| [[product/TC-PRODUCT-09\|TC-PRODUCT-09]] | **KPI delivery acceptance** (5 north star metrics) | P0 | acceptance |
| [[product/TC-PRODUCT-10\|TC-PRODUCT-10]] | 30/60/90-day soak stability | P1 | soak |

### Infrastructure (11 — NEW) — `infra/`

| ID | Tên | Priority | Phase touch |
|---|---|---|---|
| [[infra/TC-UNIT-LANGGRAPH-01\|TC-UNIT-LANGGRAPH-01]] | LangGraph graph compilation + conditional edges | P0 | ADR-0002 |
| [[infra/TC-INT-CHECKPOINT-01\|TC-INT-CHECKPOINT-01]] | PostgreSQL checkpointer crash recovery | P0 | ADR-0002 |
| [[infra/TC-INT-APPROVAL-SCHEMA-01\|TC-INT-APPROVAL-SCHEMA-01]] | Approvals 11 cột mới — migration + Zod | P0 | ADR-0009 |
| [[infra/TC-INT-APPROVAL-TIMEOUT-01\|TC-INT-APPROVAL-TIMEOUT-01]] | Approval timeout_action + delegation | P0 | ADR-0009 |
| [[infra/TC-UNIT-DECISION-MATRIX-01\|TC-UNIT-DECISION-MATRIX-01]] | Decision Boundary 3×3 matrix | P0 | P9 |
| [[infra/TC-INT-CALIBRATION-01\|TC-INT-CALIBRATION-01]] | Nightly calibration cron Platt scaling | P1 | P9 |
| [[infra/TC-INT-MAGIKA-01\|TC-INT-MAGIKA-01]] | Magika sidecar lifecycle + OOM fallback | P1 | ADR-0004 |
| [[infra/TC-INT-MAGIKA-02\|TC-INT-MAGIKA-02]] | Magika batch 1000 files throughput | P2 | ADR-0004 |
| [[infra/TC-INT-CAPABILITY-01\|TC-INT-CAPABILITY-01]] | Capability registry routing match/mismatch | P1 | P3 |
| [[infra/TC-INT-MCP-RECORDER-01\|TC-INT-MCP-RECORDER-01]] | MCP InvocationRecorder + redaction | P1 | ADR-0010 |
| [[infra/TC-INT-DRAGIN-01\|TC-INT-DRAGIN-01]] | Drag-in self-report aggregation | P2 | ADR-0008 |

### E2E Flows (8) — `e2e/`

| ID | Tên | Priority | Phase touch |
|---|---|---|---|
| [[e2e/TC-E2E-01\|TC-E2E-01]] | Daily 24h cycle — các cron không xung đột | P0 | 6, 9, 10 |
| [[e2e/TC-E2E-02\|TC-E2E-02]] | Weekly Strategic Loop — toàn bộ đến approve sprint | P0 | 2, 3, 5, 9 |
| [[e2e/TC-E2E-03\|TC-E2E-03]] | Per-feature end-to-end — intake đến live (12 ngày) | P0 | 5, 7, 8, 11, 13, 14a |
| [[e2e/TC-E2E-04\|TC-E2E-04]] | Per-Incident Response — log spike đến auto-rollback | P0 | 6, 7, 13, 15 |
| [[e2e/TC-E2E-05\|TC-E2E-05]] | Rejection cascade — pattern học và auto-adjust | P1 | 5, 9, 10 |
| [[e2e/TC-E2E-06\|TC-E2E-06]] | Self-Heal cascade — agent stuck → recover/escalate | P0 | 6 |
| [[e2e/TC-E2E-07\|TC-E2E-07]] | **NEW** PR-driven KB staleness cycle | P1 | 11 |
| [[e2e/TC-E2E-08\|TC-E2E-08]] | **NEW** T+7 outcome tracker + Efficiency Reviewer | P1 | 5, 9, 15 |

### Critical-Path Cross-Phase (14) — `cp/`

| ID | Tên | Priority | Phase touch |
|---|---|---|---|
| [[cp/TC-CP-01\|TC-CP-01]] | Intake type classification 8 loại | P1 | 5 |
| [[cp/TC-CP-02\|TC-CP-02]] | Mission spawn từ intake — bridge integrity | P0 | 5, 2 |
| [[cp/TC-CP-03\|TC-CP-03]] | Greenfield 7-stage happy path | P0 | 8 |
| [[cp/TC-CP-04\|TC-CP-04]] | Design doc conflict detection block merge | P1 | 7 |
| [[cp/TC-CP-05\|TC-CP-05]] | Feature flag canary rollout 0→5→25→50→100% | P1 | 7, 13 |
| [[cp/TC-CP-06\|TC-CP-06]] | Brier calibration block trust promotion | P1 | 9 |
| [[cp/TC-CP-07\|TC-CP-07]] | Cross-repo saga — atomic deploy + compensation | P0 | 12 |
| [[cp/TC-CP-08\|TC-CP-08]] | Hotfix forward-port — cherry-pick conflict escalation | P1 | 13 |
| [[cp/TC-CP-09\|TC-CP-09]] | **NEW** Autonomy Dial auto-promote sau 20 approvals | P0 | 3, 9 |
| [[cp/TC-CP-10\|TC-CP-10]] | **NEW** Gate quota breach triggers auditor | P0 | 3, 9 |
| [[cp/TC-CP-11\|TC-CP-11]] | **NEW** WFQ scheduler fairness 3 workspaces | P1 | 3 |
| [[cp/TC-CP-12\|TC-CP-12]] | **NEW** KB cold-start bootstrap brownfield | P1 | 11 |
| [[cp/TC-CP-13\|TC-CP-13]] | **NEW** Visual regression gate blocks PR | P1 | 14a |
| [[cp/TC-CP-14\|TC-CP-14]] | **NEW** a11y axe-core gate blocks PR | P1 | 14a |

### Chaos (7) — `chaos/`

| ID | Tên | Priority | Phase touch |
|---|---|---|---|
| [[chaos/TC-CHAOS-01\|TC-CHAOS-01]] | Kill agent mid-mission (Phase 6 kill switch) | P0 | 6 |
| [[chaos/TC-CHAOS-02\|TC-CHAOS-02]] | MCP cascade — GitLab MCP down | P0 | 4, 6, 7 |
| [[chaos/TC-CHAOS-03\|TC-CHAOS-03]] | Cost runaway — mission vượt 2x estimate | P0 | 6 |
| [[chaos/TC-CHAOS-04\|TC-CHAOS-04]] | Brain-store corruption — vector clock stale | P1 | 12 |
| [[chaos/TC-CHAOS-05\|TC-CHAOS-05]] | Deadlock — hai agent chờ nhau | P0 | 6 |
| [[chaos/TC-CHAOS-06\|TC-CHAOS-06]] | **NEW** Kill switch level 2 pause-workspace | P0 | 6 |
| [[chaos/TC-CHAOS-07\|TC-CHAOS-07]] | **NEW** Kill switch level 4 emergency-stop-all | P0 | 6 |

### Load / Performance (5) — `load/`

| ID | Tên | Priority | Phase touch |
|---|---|---|---|
| [[load/TC-LOAD-01\|TC-LOAD-01]] | 100 concurrent missions — watchdog throughput | P1 | 6 |
| [[load/TC-LOAD-02\|TC-LOAD-02]] | 1000 intakes/ngày — triage throughput | P1 | 5 |
| [[load/TC-LOAD-03\|TC-LOAD-03]] | Watchdog dưới heavy load — cron overlap | P1 | 6 |
| [[load/TC-LOAD-04\|TC-LOAD-04]] | Release Train builder — 50 feature_keys đồng thời | P2 | 13 |
| [[load/TC-LOAD-05\|TC-LOAD-05]] | Approval Center — 200 pending burst | P1 | 3 |

### Manual TC Fallback (11) — `manual/`

LLM-as-Judge có thể miss → cần manual.

| ID | Tên | Ghi chú |
|---|---|---|
| [[manual/MT-01\|MT-01]] | Approval modal — double-confirm level ≥ 3 | UX micro-interaction |
| [[manual/MT-02\|MT-02]] | Kill button disabled khi workspace idle | State-dependent UI |
| [[manual/MT-03\|MT-03]] | Intake form — empty title submission | Edge case |
| [[manual/MT-04\|MT-04]] | Weekly digest email format trên mobile | Mobile email rendering |
| [[manual/MT-05\|MT-05]] | Explain auditability — decision_log reader | Audit trail |
| [[manual/MT-06\|MT-06]] | RBAC — non-admin không thấy tab Kill Switch | Security UX |
| [[manual/MT-07\|MT-07]] | Conflict modal — 2 design docs cùng component | Race UX |
| [[manual/MT-08\|MT-08]] | Canary metric breach UI — auto-rollback notification | Push UX |
| [[manual/MT-09\|MT-09]] | Greenfield intake — file attachment Magika scan | File upload |
| [[manual/MT-10\|MT-10]] | Mobile approval swipe (v1.1 deferred) | Mobile RN |
| [[manual/MT-11\|MT-11]] | **NEW** Drag-in toggle visible trên approval card | ADR-0008 UX |

### Smoke (11, runtime < 5 phút) — `smoke/`

| ID | Tên |
|---|---|
| [[smoke/SM-01\|SM-01]] | Health endpoint |
| [[smoke/SM-02\|SM-02]] | Intake submit |
| [[smoke/SM-03\|SM-03]] | Watchdog tick |
| [[smoke/SM-04\|SM-04]] | Approval item create |
| [[smoke/SM-05\|SM-05]] | Strategic Loop brain snapshot |
| [[smoke/SM-06\|SM-06]] | Feature flag evaluate |
| [[smoke/SM-07\|SM-07]] | GitLab MCP health probe |
| [[smoke/SM-08\|SM-08]] | Kill switch level 1 (cancel-task) |
| [[smoke/SM-09\|SM-09]] | RBAC gate — unauthenticated |
| [[smoke/SM-10\|SM-10]] | Train builder dry-run |
| [[smoke/SM-11\|SM-11]] | **NEW** Production synthetic probe |

### Quality Gates — [[quality-gates]]

Block conditions, soak windows, rollback triggers.

---

## Workflow review

Mỗi file có header trạng thái:

```
status: draft → reviewed → approved → implemented
```

**Quy trình:**
1. User đọc từng file, comment / sửa nội dung "Steps" / "Expected"
2. Đổi `status` thành `reviewed` hoặc `approved`
3. Sau khi approve toàn bộ → mới bắt đầu implement
4. Khi test code đã viết & pass → `status: implemented`

## Tổng số test cần thêm

| Layer | Số lượng | Effort ước tính |
|---|---|---|
| **Product Lifecycle (NORTH STAR)** | **10** | **5–30h/cái** |
| Infrastructure | 11 | 3–6h/cái |
| E2E | 8 | 4–8h/cái |
| Cross-phase | 14 | 2–6h/cái |
| Chaos | 7 | 4–6h/cái |
| Load | 5 | 6–10h/cái (cần load infra) |
| Manual | 11 | 0.5h/cái (script + checklist) |
| Smoke | 11 | 1h/cái |
| **Tổng** | **77** | **~380–600h** |

## Test pyramid mục tiêu (sau khi đầy đủ)

```
                Acceptance (1)        TC-PRODUCT-09
              Soak (3)                TC-PRODUCT-01, -03, -10
            Chaos (7)                 TC-CHAOS-*
          Load (5)                    TC-LOAD-*
        E2E (10)                      TC-E2E-* + TC-PRODUCT-02/04/05/06/07/08
      Integration (~25)               TC-CP-* + TC-INT-*
    Unit (~180)                       Existing + TC-UNIT-*
```

**Đỉnh kim tự tháp = TC-PRODUCT-01 (90-day) + TC-PRODUCT-09 (KPI acceptance).**
Nếu 2 cái này pass → claim production-ready.
Nếu fail → mọi gì khác chỉ là smoke check.

## Liên quan

- [[01-Gap-Analysis]] — báo cáo gap test plan vs design (tạo ra 23 scenario mới này)
- [[00-Evaluation-Report]] — báo cáo đánh giá toàn diện 5 dimension
- [[quality-gates]] — block conditions, soak windows, rollback triggers
