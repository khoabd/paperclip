---
id: TC-INT-MCP-RECORDER-01
name: MCP InvocationRecorder + redaction
layer: integration
priority: P1
phases: [P4-MCP, ADR-0010]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-30
estimated_effort_hours: 4
---

# TC-INT-MCP-RECORDER-01 — MCP InvocationRecorder

## Mục tiêu
Verify mỗi MCP tool call được ghi audit trail với redaction (token/secret bị che).

## Pre-condition
- MCP client framework configured
- InvocationRecorder wired
- Test MCP server (mock)

## Steps
1. Call MCP tool: `gitlab.create_branch({ token: "secret-abc", branch: "feature/test" })`
2. Verify `mcp_tool_invocations` row được tạo
3. Verify request body redacted: `token: "[REDACTED]"`, branch không redacted
4. Verify response body redacted (nếu có secret pattern)
5. Test với 5 secret patterns: API_KEY, TOKEN, SECRET, PASSWORD, BEARER
6. Negative: invocation timeout → recorder vẫn ghi với status='timeout'

## Expected
- Mỗi invocation có audit row
- Secrets redacted ở cả request và response
- Status tracked (success/timeout/error)

## Acceptance checklist
- [ ] mcp_tool_invocations row có entry
- [ ] Token "[REDACTED]" trong request_body JSONB
- [ ] Non-secret fields preserved
- [ ] 5 secret patterns redacted
- [ ] Timeout case: status='timeout' tracked
- [ ] Error case: stack trace capture (nhưng redact secret trong stack)
- [ ] Latency tracked: latency_ms field

## Implementation notes
**File:** `server/src/platform/mcp/__tests__/invocation-recorder.integration.test.ts`

**Helpers:**
- `mockMCPServer(tool, response)`
- `assertRedacted(jsonb, fieldPath, expectedRedactedValue)`

**Risk:**
- Redaction patterns cần list rõ trong config
- Stack trace có thể leak secret từ error message — cần regex sweep

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
