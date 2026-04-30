---
id: TC-INT-MAGIKA-02
name: Magika batch classify 1000 files throughput
layer: integration
priority: P2
phases: [P11, ADR-0004]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-30
estimated_effort_hours: 4
---

# TC-INT-MAGIKA-02 — Magika batch throughput

## Mục tiêu
Verify Magika batch classify endpoint xử lý 1000 files với throughput hợp lý.

## Pre-condition
- Magika sidecar healthy
- 1000 sample files (mix: .ts, .py, .md, .json, .png)

## Steps
1. POST `/classify-batch` với 1000 files
2. Đo throughput (files/giây)
3. Verify mỗi file có classification result
4. Verify accuracy ≥ 95% (so với expected type)
5. Memory check: sidecar không OOM

## Expected
- Throughput ≥ 100 files/giây
- Accuracy ≥ 95%
- No OOM

## Acceptance checklist
- [ ] 1000 files classified
- [ ] Throughput ≥ 100/s
- [ ] Accuracy ≥ 95%
- [ ] Memory stable (sidecar RSS < 1GB)
- [ ] No request timeout
- [ ] Optional: chunk batch (chia 4 × 250)

## Implementation notes
**File:** `server/src/kb/__tests__/magika-batch.load.test.ts`

**Helpers:**
- `generateSampleFiles(count, distribution)`
- `measureThroughput(promise, count)`

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
