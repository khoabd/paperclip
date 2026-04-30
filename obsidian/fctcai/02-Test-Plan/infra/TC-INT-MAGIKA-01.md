---
id: TC-INT-MAGIKA-01
name: Magika sidecar lifecycle — cold start, OOM, fallback
layer: integration
priority: P1
phases: [P11, ADR-0004]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-30
estimated_effort_hours: 5
---

# TC-INT-MAGIKA-01 — Magika sidecar lifecycle

## Mục tiêu
Verify Python sidecar process lifecycle: cold start time, OOM crash → fallback to extension heuristics, restart logic.

## Pre-condition
- Magika Python sidecar binary available
- Sidecar manager class (`MagikaSidecar`) implement spawn/kill/restart

## Steps
1. **Cold start:** Spawn sidecar, đo thời gian từ spawn → ready (POST /classify works)
2. Verify cold start < 5s
3. **Healthy classify:** POST `/classify` với 1 file, verify response
4. **OOM crash:** Inject memory pressure (POST 100 large files trong 1 request) → sidecar crash
5. Verify fallback: extension-based heuristic được dùng
6. Verify restart logic: sidecar được spawn lại sau 30s
7. **Supply-chain anomaly:** Upload file `.sh` đặt tên `.txt` → Magika detect content mismatch

## Expected
- Cold start < 5s
- OOM → fallback hoạt động (không block luồng caller)
- Auto-restart sau crash
- Supply-chain anomaly detected

## Acceptance checklist
- [ ] Cold start time < 5s
- [ ] Healthy classify response
- [ ] OOM crash handled, fallback heuristic dùng
- [ ] Auto-restart sau 30s
- [ ] Supply-chain anomaly: detect `.sh` content trong `.txt` file
- [ ] Sidecar log captured cho debug

## Implementation notes
**File:** `server/src/kb/__tests__/magika-sidecar.integration.test.ts`

**Helpers:**
- `spawnMagikaSidecar()` — return process handle
- `injectMemoryPressure(sidecar)`
- `waitForRestart(sidecar, timeoutMs)`

**Risk:**
- CI có Python runtime với Magika installed không? — cần Docker hoặc skip nếu không có
- Cross-platform: macOS/Linux test khác behavior

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
