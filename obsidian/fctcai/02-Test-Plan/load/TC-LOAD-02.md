---
id: TC-LOAD-02
name: 1000 intakes/ngày — triage throughput
layer: load
priority: P1
phases: [P5]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-29
estimated_effort_hours: 8
---

# TC-LOAD-02 — Triage throughput

## Mục tiêu
Verify IntakeTriageAgent xử lý 1000 intakes/ngày với p99 < 5s/intake và dedup hoạt động.

## Pre-condition
- IntakeTriageAgent với embedding model mock
- Distribution: 40% feature_request, 30% bug_report, 20% question, 10% other

## Steps
1. Batch submit 1000 intakes với text random theo distribution
2. Đo throughput (intakes/giây)
3. Đo p50/p95/p99 latency cho mỗi triage call
4. Verify dedup hoạt động (inject 50 duplicates)

## Expected
- Throughput ≥ 50 intakes/phút
- p99 triage latency < 5s/intake
- Dedup rate chính xác (50 duplicates không tạo mới)

## Acceptance checklist
- [ ] 1000 intakes processed
- [ ] Throughput ≥ 50/phút (≈ 0.83/giây)
- [ ] p50 < 1s, p95 < 3s, p99 < 5s
- [ ] 50 duplicates không tạo intake mới (dedup table có 50 hits)
- [ ] Memory stable
- [ ] No DB connection pool exhausted

## Implementation notes
**File:** `server/src/intake/__tests__/triage-throughput.load.test.ts`

**Helpers:**
- `generateIntakeBatch(count, distribution)`
- `measureLatencies(promises)` — return percentiles
- `injectDuplicates(intakes, count)`

**Risk:**
- Embedding model mock: dùng deterministic stub (hash → fake vector) thay vì real model
- DB connection pool: cần cấu hình ≥ 20 connections để load test ý nghĩa

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
