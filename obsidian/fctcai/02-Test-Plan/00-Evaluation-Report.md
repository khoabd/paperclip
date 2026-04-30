---
title: FCTCAI 5-Dimension Evaluation Report
created: 2026-04-29
status: draft
agents_used: [qa-analyst, oh-my-claudecode:critic, oh-my-claudecode:scientist, business-analyst, oh-my-claudecode:verifier]
---

# Báo cáo đánh giá toàn diện — FCTCAI / Custom Paperclip

Tổng hợp từ 5 sub-agent độc lập (QA, Quality, Performance, Business, Completion). Mỗi dimension có verdict riêng + cross-check.

---

## TL;DR — Verdict tổng

| Dimension | Verdict | Score |
|---|---|---|
| **Test scenarios (kịch bản)** | 44 scenarios drafted ([[02-Test-Plan/_index|_index]]) | — |
| **Code quality** | Accept-with-reservations | **7.5 / 10** |
| **Performance** | Production-ready < 1k workspaces, có điều kiện | — |
| **Business value** | Backend tốt, UX/wiring chưa ship được | **35%** |
| **Completion** | REQUEST_CHANGES — HTTP/UI gap | **~55%** |

**Kết luận:** Backend logic và schema rất chỉn chu (~92%), nhưng thiếu toàn bộ HTTP wiring (12 module = 0 endpoint) và UI integration → founder mở app không thấy gì mới. **Không ready ship**.

---

## 1. Kịch bản kiểm thử (Test Scenarios)

→ Xem [[02-Test-Plan/_index|_index]] cho danh sách 44 kịch bản (E2E×6, Critical-Path×8, Chaos×5, Load×5, Manual×10, Smoke×10).

**Test pyramid hiện tại:**
- Unit ~180 / Integration ~90 / E2E **chỉ 1** / Chaos+Load **0**
- 277 file test, 1910/1912 pass

**Gap lớn nhất:** E2E + Chaos + Load gần như trống. 6 flow chính trong `Full-System-Workflow-and-Coordination` chưa có E2E tương ứng.

---

## 2. Đánh giá chất lượng code (7.5 / 10)

### Top 10 issues

| # | Severity | Category | Finding (file:line) |
|---|---|---|---|
| 1 | **CRITICAL** | Concurrency | `mission-runner.ts:65-71` — Race trong tick(): SELECT + canTransition + UPDATE không có optimistic lock; transaction chỉ ôm writes |
| 2 | **CRITICAL** | Concurrency | `migration-orchestrator.ts:76-88` — `recordProgress()` TOCTOU lost-update |
| 3 | **HIGH** | Concurrency | `kill-switch.ts:34-89` — `apply()` thiếu transaction; global kill load full table |
| 4 | **HIGH** | Type safety | 24 chỗ cast `as` từ DB rows (mission-runner, intake-workflow, kill-switch, heartbeat-store, approval-router) — không runtime validate |
| 5 | **HIGH** | Test quality | `full-system-gate-checker.ts:208,234,256,303,327,353,389,413,443` — 9/15 criteria check `total ≥ 0` (luôn true) |
| 6 | **HIGH** | Missing feature | `mission-state-machine.ts:66` — `gateTimedOut` flag tồn tại nhưng runner luôn pass `false` (không có heartbeat-based timeout) |
| 7 | **MEDIUM** | Maintainability | `full-system-gate-checker.ts` — 508 LOC với 15 method giống hệt nhau (try/catch + query) → có thể giảm còn ~200 LOC |
| 8 | **MEDIUM** | DIP | `platform.ts:32-44` — Hardcode 11 services, không inject overrides |
| 9 | **MEDIUM** | Idempotency | `saga-orchestrator.ts:114-132` — Step kẹt ở `running` vĩnh viễn nếu crash giữa 3 writes |
| 10 | **MEDIUM** | Consistency | `heartbeat-store.ts:93-118` — Raw SQL với manual mapping, fragile |

### Điểm mạnh
- Pure functions tách side-effects rõ ràng (state machine, watchdog rules, classifier)
- Naming conventions nhất quán (`*Store`, `*Runner`, `*Scorer`)
- Test infrastructure tốt (embedded PG graceful skip, afterEach cleanup)
- Zero `any`, zero TODO/FIXME/HACK trong platform/intake/release

### Cái còn thiếu
- Retry logic ở mọi service
- Rate limiting cho heartbeat publish
- Metrics/observability emission tự động
- Graceful shutdown
- Vector clock không tích hợp với saga

---

## 3. Đánh giá hiệu suất (Performance)

### Top 10 hotspots

| # | Severity | File:line | Issue | Impact |
|---|---|---|---|---|
| 1 | **CRITICAL** | `mission-runner.ts:205-246` | `stepCounts()` gọi 2 lần/tick, mỗi lần SELECT toàn bộ steps + count trong JS | +10-50ms/tick |
| 2 | **CRITICAL** | `watchdog.ts:44-65` | Sequential `buildCtx` cho từng mission, không LIMIT, không Promise.all | O(N) latency, ~200ms+ với 100 missions |
| 3 | **CRITICAL** | `kill-switch.ts:129-132` | Global level: `SELECT id, status FROM missions` không WHERE | Full table scan ở 10k missions |
| 4 | **HIGH** | `brain-store.ts:213-261` | Read-full-body → mutate → write-full-body, không optimistic lock; race condition | Mất insight; revision phình |
| 5 | **HIGH** | `dbscan-clusterer.ts:52-59` | DBSCAN O(n²) JS thuần, không cache neighbors | n=2000 → ~2-10s blocking |
| 6 | **HIGH** | `wfq-scheduler.ts:69-80` | Map scan O(L); state in-memory only — restart mất queue | Crash mất state |
| 7 | **HIGH** | `l2-timeline-estimator.ts:87-117` | Historical query không LIMIT | Unbounded scan |
| 8 | **MEDIUM** | `cost-attributor.ts:32-56` | INSERT + upsert sequential, không atomic | Quota drift khi crash |
| 9 | **MEDIUM** | `embedded-postgres.ts` | 277 file × spinup riêng | CI runtime cao, RAM pressure |
| 10 | **MEDIUM** | `mission-runner.ts:137-155` | Loop INSERT trong transaction thay vì batch | +50ms/planning |

### Index gap

| Table | Column thiếu | Vấn đề |
|---|---|---|
| `document_revisions` | `(document_id, revision_number)` | Check max revision chậm |
| `rejection_events` | `(company_id, mission_id)` | Query by mission scan |
| `liveness_heartbeats` | `sent_at DESC` | Watchdog latest heartbeat lookup |
| `mission_steps` | `(mission_id, status)` | stepCounts không filter tại DB |
| `missions` | partial index `WHERE status='executing'` | Watchdog scan |
| `system_health_metrics` | TTL/retention | Phình không giới hạn |
| `document_embeddings` | GIN/vector | Không thể ANN search |

### Verdict scaling

- **< 200 concurrent missions:** OK
- **~200 concurrent:** Watchdog tick > 2s, overlap với tick tiếp theo
- **~1000 missions:** stepCounts double-query tích lũy
- **~500 rejection events:** DBSCAN block ~2-5s
- **~5000 brain revisions:** appendSection body > 50KB, race xuất hiện
- **Sụp tại:** Global kill 10k+, WFQ restart mất state, CI OOM

### 3 fix ưu tiên
1. `stepCounts` → `GROUP BY status`
2. Watchdog `buildCtx` → `Promise.all`
3. DBSCAN → pre-compute neighbors + cap n=500

---

## 4. Đánh giá nghiệp vụ (Business — 35%)

### Mapping feature → design intent

| Feature | Design intent | Impl thực tế | Gap |
|---|---|---|---|
| Strategic Loop | Tự kích hoạt định kỳ | State machine thuần, **không cron nào gọi tick()** trong `index.ts` | **Major gap** |
| Self-Healing | 5 escalation level + MCP cascade + PagerDuty | Kill 5 level OK; **mcp_cascade chỉ là stub** (`watchdog-rules.ts:69`); không có notify dispatcher | **Major gap** |
| Greenfield 7-stage | Đúng spec | Khớp 7 stage trong `greenfield-stage-seeder.ts` | Pass |
| Brier calibration | Block trust khi > 0.15 | `TrustPromotionGuard.canPromote()` đúng spec | Pass |

### 15 Acceptance Criteria của Full-System-Gate

| # | Đo đúng nghiệp vụ? | Verdict |
|---|---|---|
| 1 | KHÔNG (chỉ đếm executing missions, không đo giờ human) | Rubber stamp |
| 2 | KHÔNG (lookup metric row chưa được populate) | Rubber stamp |
| 3 | KHÔNG | Rubber stamp |
| 4 | Đúng hướng (drag-in count) — nhưng thiếu silent_edit/cli detection | Partial |
| 5-7, 9-11, 13, 15 | KHÔNG (`total ≥ 0` luôn true) | Rubber stamp |
| 8 (Brier) | **ĐÚNG** — thật sự có thể fail | Real check |
| 12 (Mobile) | Hard-coded DEFERRED | N/A |
| 14 | Phần nào (cần metrics populated) | Partial |

**Tổng kết:** 1/15 criterion thật sự đo đúng nghiệp vụ. 9/15 là rubber stamp. 4/15 phụ thuộc metrics chưa populate.

### Coverage personas (founder)

- **Daily startup:** Mở app chỉ thấy paperclip gốc — **KHÔNG có trang Mission Center, Intake Hub, Watchdog, Greenfield Wizard**
- **Mission stuck:** Không có notification dispatch — founder phải chủ động vào app và tìm trang chưa tồn tại
- **Cost spike, vắng 24h:** Pause OK, nhưng không có kênh thông báo, route resume chưa wire HTTP

### Top 5 nghiệp vụ còn thiếu

1. **Server runtime wiring** — Watchdog/MissionRunner/BrierRunner/etc. không được gọi trong `server/src/index.ts`/`app.ts`
2. **HTTP API cho domain mới** — 12 module, 0 endpoint
3. **Notification & escalation** — không có PagerDuty/email/push dispatcher
4. **UI pages cho domain mới** — 0 page mới
5. **MCP cascade rule** — type tồn tại, logic không có

### Top 5 over-engineered

1. **WFQ Scheduler** — fairness cho 1 founder không ý nghĩa
2. **Cross-workspace Learning** — single-tenant không tạo data
3. **Mobile native + BrowserStack cross-device** — chưa có RN app
4. **Vector Clock Auditor** — distributed concern, single-founder không cần
5. **DBSCAN với embedding cosine** — < 100 events không cluster được

---

## 5. Đánh giá độ hoàn thiện (Completion — 55%)

### Inventory bảng

| Layer | % hoàn thành |
|---|---|
| Schema / Migrations | **95%** — 153 entries journal, 0 orphan, ADR-0009 thiếu 7 cột |
| Service / Business Logic | **92%** — 304 non-test TS files |
| Test Suite | **78%** — 277 files, 2865/2872 pass; nhiều path chỉ smoke |
| HTTP Layer | **8%** — 12/13 service không có route |
| UI Integration | **3%** — 0 page mới cho 12 phase feature |
| **Overall** | **~55%** |

### Top 10 unfinished

| # | Item | Severity | Effort |
|---|---|---|---|
| 1 | HTTP routes cho 12 module mới | **Blocker** | 40h |
| 2 | ADR-0009: 7 cột approvals + Zod schemas | **Blocker** | 8h |
| 3 | Observability: Prometheus/Grafana scrape endpoint | **Blocker** | 12h |
| 4 | UI pages: Intake/Mission/Watchdog/Brain/Greenfield | **Blocker** | 60h |
| 5 | `formatWorkspace()` helper (ADR-0006) | Major | 2h |
| 6 | ADR-0007 sub-keys brain/personas, brain/principles, brain/glossary, brain/decisions | Major | 6h |
| 7 | Kill-switch escalation/notify path | Major | 8h |
| 8 | Brier calibration block enforcement integration | Major | 4h |
| 9 | 6 test timeouts trong opencode-local-adapter | Major | 3h |
| 10 | Greenfield seeder/recovery unit tests; saga compensation tests | Minor | 6h |

**Tổng effort còn lại: ~150h** để đạt production ready.

### Production readiness checklist

| Item | Status |
|---|---|
| `/health` endpoint | PASS |
| `/health/smoke` migration check | PASS |
| Migrations runnable từ scratch | PASS |
| Cold-start smoke test | PARTIAL |
| Secrets rotation runbook | PARTIAL (no HTTP endpoint) |
| Prometheus/Grafana | **MISSING** |
| Fresh test suite | **FAIL** (6 timeouts) |

---

## 6. Cross-cutting findings

3 sub-agent (Quality, Business, Completion) đều flag **cùng vấn đề**:

| Vấn đề | Quality | Performance | Business | Completion |
|---|---|---|---|---|
| Service không được wire vào server runtime | — | (implicit) | **Top 1 gap** | **Top 1 unfinished** |
| Full-System-Gate `total ≥ 0` rubber stamp | **#5 HIGH** | — | **9/15 criteria** | (implicit) |
| Mission state race condition | **#1 CRITICAL** | **#1+#2 hot path** | — | — |
| MCP cascade rule chỉ là stub | — | — | **Top 5 gap** | (implicit) |
| Brain mutate read-full-body race | — | **#4 HIGH** | **Risk #3** | — |
| HTTP/UI hoàn toàn vắng | — | — | **Top 1+4 gap** | **Blocker #1+4** |

→ Đây là các issue cần fix đầu tiên (multi-source confirmation).

---

## 7. Roadmap đề xuất (sau review)

### Phase A — Stabilization (40h)
1. Fix race condition mission-runner (optimistic lock) — 4h
2. Fix migration-orchestrator TOCTOU — 2h
3. Fix `stepCounts` GROUP BY — 2h
4. Fix watchdog `buildCtx` Promise.all — 4h
5. Fix DBSCAN pre-compute neighbors — 4h
6. Fix 6 test timeouts — 3h
7. Brain optimistic lock + pull insights ra bảng riêng — 8h
8. Kill-switch transaction wrapping — 2h
9. Cost-attributor transaction — 2h
10. Saga step timeout/retry — 4h
11. Add 7 missing approvals columns + Zod — 8h

### Phase B — Wiring (52h)
12. Server runtime: cron jobs cho Watchdog/MissionRunner/BrierRunner — 8h
13. HTTP routes: `/api/intake`, `/api/missions`, `/api/watchdog`, `/api/greenfield`, `/api/kill-switch`, `/api/brier`, `/api/rejection`, `/api/kb`, `/api/cross-repo`, `/api/testing`, `/api/release` — 40h
14. Observability: prom-client + `/metrics` endpoint — 12h

### Phase C — Notification (12h)
15. Notification dispatcher (email + push + Slack) — 8h
16. MCP cascade rule implementation — 4h

### Phase D — UI (60h)
17. Mission Center page — 16h
18. Intake Hub page — 12h
19. Watchdog/Health Dashboard — 12h
20. Greenfield Wizard — 12h
21. Brain Viewer — 8h

### Phase E — Test Real Coverage (60-100h)
22. 6 E2E scenarios — 30-50h
23. 5 Chaos scenarios — 20-30h
24. 5 Load scenarios — 30-50h
25. Replace 9 rubber-stamp criteria với real checks — 8h

### Phase F — Real Full-System Gate (8h)
26. Re-run gate checker với real thresholds → confirm pass

**Tổng effort còn lại: ~230-280h** trước khi thật sự production-ready.

---

## Reviewer notes

> _Để bạn comment / chỉnh / approve từng dimension_

## Status
- [x] Draft
- [ ] Reviewed by user
- [ ] Approved
