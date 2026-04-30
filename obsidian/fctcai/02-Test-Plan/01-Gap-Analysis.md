---
title: Test Plan vs Design — Gap Analysis
created: 2026-04-30
status: draft
reviewer: qa-analyst sub-agent (cross-checked 44 scenarios vs 20+ design docs)
---

# Gap Analysis — Test Plan vs Design Intent

## TL;DR

44 scenarios hiện tại **CHƯA ĐỦ**. Cover tốt happy path + một số chaos/load, nhưng:
- Toàn bộ **infrastructure layer** (LangGraph, MCP client, approvals schema, progressive trust) gần như chưa có coverage
- Toàn bộ **KB/Observability path** gần như không có test
- Cần thêm **~21 scenarios** nữa

---

## Coverage 5 mục tiêu ban đầu của user

| Keyword | Coverage | Gap chính |
|---|---|---|
| Product lifecycle (intake→idea→dev→release→outcome) | **55%** | Thiếu T+7 outcome tracker test, Efficiency Reviewer learning cycle |
| Department DAG (agents, lanes, WFQ, multi-agent) | **20%** | Capability registry routing, WFQ fairness, LangGraph DAG edges hoàn toàn chưa test |
| Tool-calling agents (MCP, tool registry, capability) | **35%** | Chỉ test failure path (circuit breaker); InvocationRecorder, redaction, happy path chưa có |
| Obsidian as knowledge base (KB, Magika, staleness) | **10%** ⚠️ | KB cold-start, PR-driven update, staleness cron, RAG/pgvector — **gần như không có test nào** |
| Real-time console observability | **25%** | Chỉ có manual UX test, không có automated test cho decision_log integrity hay real-time latency |

---

## TOP 10 GAP nghiêm trọng

| # | Severity | Gap | Đề xuất TC mới |
|---|---|---|---|
| 1 | **CRITICAL** | LangGraph graph compilation + PostgreSQL checkpointer (ADR-0002) | TC-UNIT-LANGGRAPH-01, TC-INT-CHECKPOINT-01 |
| 2 | **CRITICAL** | Autonomy Dial progressive trust auto-promotion (4 levels) | TC-CP-09, TC-CP-10 |
| 3 | **CRITICAL** | Approvals 11 cột mới (ADR-0009): migration, Zod, timeout_action, delegation | TC-INT-APPROVAL-SCHEMA-01, TC-INT-APPROVAL-TIMEOUT-01 |
| 4 | **HIGH** | Magika sidecar lifecycle: cold start, OOM, batch throughput (ADR-0004) | TC-INT-MAGIKA-01, TC-INT-MAGIKA-02 |
| 5 | **HIGH** | Department DAG / Capability Registry routing + WFQ fairness | TC-CP-11, TC-INT-CAPABILITY-01 |
| 6 | **HIGH** | KB cold-start bootstrap + PR-driven staleness cycle | TC-CP-12, TC-E2E-07 |
| 7 | **HIGH** | Decision Boundary 3×3 matrix (Reversibility × Blast × Uncertainty) | TC-UNIT-DECISION-MATRIX-01, TC-INT-CALIBRATION-01 |
| 8 | **MEDIUM** | Drag-in detection self-report aggregation (ADR-0008) | TC-INT-DRAGIN-01, MT-11 |
| 9 | **MEDIUM** | 16-dim quality matrix: dim 8-16 (visual, a11y, cross-browser, i18n, UX heuristic, security, synthetic) | TC-CP-13, TC-CP-14, SM-11 |
| 10 | **MEDIUM** | Kill switch levels 2-5 (chỉ test level 1) | TC-CHAOS-06, TC-CHAOS-07 |

---

## Mapping chi tiết: Design → Test (44 row)

| # | Design Concept | Doc | TC | Mức độ |
|---|---|---|---|---|
| 1 | Daily 24h cycle | Full-System-Workflow §2.2 | TC-E2E-01 | FULL |
| 2 | Weekly Strategic Loop | Autonomous-PM | TC-E2E-02 | FULL |
| 3 | Per-feature pipeline | Full-System-Workflow §5 | TC-E2E-03 | PARTIAL (thiếu KB/Magika path) |
| 4 | Incident response | Full-System-Workflow §7 | TC-E2E-04 | PARTIAL (thiếu OpenSearch alert chain) |
| 5 | Rejection cascade | Rejection-Learning | TC-E2E-05 | PARTIAL (DBSCAN assertion thiếu) |
| 6 | Self-heal cascade | Self-Healing | TC-E2E-06 | PARTIAL (3/7 failure mode) |
| 7 | Intake 8-type classification | Human-Intake | TC-CP-01 | FULL |
| 8 | IntakeMissionBridge | Human-Intake §10 | TC-CP-02 | FULL |
| 9 | Greenfield 7-stage | Greenfield-Bootstrap | TC-CP-03 | PARTIAL (recovery missing) |
| 10 | Design conflict detection | Development-Flow | TC-CP-04 | FULL |
| 11 | Canary 0→5→25→50→100% | Git-Branch-Tag | TC-CP-05 | FULL |
| 12 | Brier block trust | Cross-Repo §4 | TC-CP-06 | PARTIAL (threshold tuning missing) |
| 13 | Cross-repo saga | Cross-Repo §1 | TC-CP-07 | FULL |
| 14 | Hotfix forward-port | Git-Branch-Tag §7.5 | TC-CP-08 | FULL |
| 15 | Kill agent mid-mission | Self-Healing §5 | TC-CHAOS-01 | PARTIAL (chỉ level 1) |
| 16 | MCP cascade | ADR-0010 | TC-CHAOS-02 | FULL |
| 17 | Cost runaway | Self-Healing Rule 4 | TC-CHAOS-03 | FULL |
| 18 | Vector clock staleness | Cross-Repo §5 | TC-CHAOS-04 | PARTIAL |
| 19 | Deadlock | Self-Healing §3 | TC-CHAOS-05 | FULL |
| 20-24 | Load tests | Various | TC-LOAD-01..05 | FULL |
| **25** | **LangGraph compilation** | **ADR-0002** | **MISSING** | **MISSING** |
| **26** | **Magika sidecar lifecycle** | **ADR-0004** | **MT-09 shallow** | **MISSING** |
| **27** | **Drag-in self-report** | **ADR-0008** | **MISSING** | **MISSING** |
| **28** | **Approvals 11 cột** | **ADR-0009** | **MISSING** | **MISSING** |
| 29 | MCP InvocationRecorder | ADR-0010 | TC-CHAOS-02 (gián tiếp) | PARTIAL |
| **30** | **Autonomy Dial 4 levels** | **Autonomy-Dial** | **MISSING** | **MISSING** |
| **31** | **Decision Boundary matrix** | **Decision-Boundary** | **MISSING** | **MISSING** |
| **32** | **16-dim quality (dim 8-16)** | **Testing-Quality** | **TC-E2E-03 (1 dim)** | **MISSING** |
| **33** | **KB cold-start** | **KB-Management §3** | **MISSING** | **MISSING** |
| **34** | **KB staleness PR-driven** | **KB-Management §4** | **MISSING** | **MISSING** |
| **35** | **Persona test scenarios** | **Testing §11** | **MISSING** | **MISSING** |
| **36** | **Visual regression pipeline** | **Testing §3** | **MISSING** | **MISSING** |
| **37** | **a11y axe-core gate** | **Testing §4** | **MISSING** | **MISSING** |
| **38** | **Production synthetic probe** | **Testing §14** | **MISSING** | **MISSING** |
| **39** | **Department DAG WFQ** | **Paperclip-Platform §4** | **MISSING** | **MISSING** |
| **40** | **Capability Registry routing** | **Auto-Operations §7** | **MISSING** | **MISSING** |
| 41 | DBSCAN auto-promotion | Rejection §4 | TC-E2E-05 (gián tiếp) | PARTIAL |
| 42 | Hotfix worktree isolation | Git-Branch-Tag §7 | TC-CP-08 | PARTIAL |
| 43 | Real-time "Why?" panel | UX-Strategy §3 | MT-05 | PARTIAL |
| **44** | **Notification batching** | **Autonomy-Dial §8** | **MISSING** | **MISSING** |

→ **15/44 (34%) là MISSING**, **10/44 (23%) là PARTIAL**, **19/44 (43%) là FULL**.

---

## ~21 scenarios cần thêm

| Nhóm | TC mới gợi ý | Số |
|---|---|---|
| **Infrastructure** | TC-UNIT-LANGGRAPH-01, TC-INT-CHECKPOINT-01 | 2 |
| **Approvals schema** | TC-INT-APPROVAL-SCHEMA-01, TC-INT-APPROVAL-TIMEOUT-01 | 2 |
| **Autonomy + trust** | TC-CP-09 (auto-promote), TC-CP-10 (gate quota breach) | 2 |
| **Decision Boundary** | TC-UNIT-DECISION-MATRIX-01, TC-INT-CALIBRATION-01 | 2 |
| **Magika** | TC-INT-MAGIKA-01 (lifecycle), TC-INT-MAGIKA-02 (batch throughput) | 2 |
| **KB pipeline** | TC-CP-12 (cold-start), TC-E2E-07 (PR-driven staleness) | 2 |
| **Department DAG** | TC-CP-11 (WFQ fairness), TC-INT-CAPABILITY-01 (routing) | 2 |
| **Kill switch** | TC-CHAOS-06 (level 2 pause-workspace), TC-CHAOS-07 (level 4 emergency-stop-all) | 2 |
| **MCP framework** | TC-INT-MCP-RECORDER-01 (InvocationRecorder + redaction) | 1 |
| **Outcome cycle** | TC-E2E-08 (T+7 outcome + Efficiency Reviewer learning loop) | 1 |
| **Drag-in** | TC-INT-DRAGIN-01, MT-11 | 2 |
| **16-dim quality** | TC-CP-13 (visual gate), TC-CP-14 (a11y gate), SM-11 (synthetic probe) | 3 |
| **Tổng** | | **23** |

---

## TOP 3 hành động tiếp theo

### 1. TC-UNIT-LANGGRAPH-01 + TC-INT-CHECKPOINT-01 — UNBLOCK toàn pyramid
**Effort: 4-6h.** LangGraph là xương sống orchestration. Nếu graph compile fail hoặc checkpoint corrupt → mọi E2E hiện có build trên nền không ổn định. **Phải làm trước** mọi test khác.

### 2. TC-INT-APPROVAL-SCHEMA-01 + migration test
**Effort: 8h.** ADR-0009 thêm 11 cột nhưng chưa test backward compat. **Block condition:** không promote Phase 3 đến bất kỳ env nào trước khi pass.

### 3. Nâng TC-CP-09 (Autonomy Dial progressive trust) lên P0
**Effort: 6h.** "Policy layer áp lên mọi gate". Nếu auto-promote logic sai → autonomy metric "≤ 8 gates/project/week" không bao giờ đạt được, hoặc ngược lại — gate quá ít → quyết định nguy hiểm tự chạy.

---

## Tổng số test plan sau khi bổ sung

| Trước | 44 scenarios |
| Bổ sung | +23 scenarios |
| **Sau** | **67 scenarios** |

**Effort còn lại để hoàn thành test plan:** ~80-120h cho 23 scenario mới + ~150-250h cho implement 67 scenario = **~230-370h tổng**.

---

## Reviewer notes
> _User comment / điều chỉnh ưu tiên tại đây_

## Status
- [x] Draft (cross-check sub-agent)
- [ ] Reviewed by user
- [ ] Approved
