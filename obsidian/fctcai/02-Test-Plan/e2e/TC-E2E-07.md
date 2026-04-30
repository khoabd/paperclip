---
id: TC-E2E-07
name: PR-driven KB staleness cycle — webhook → diff → update
layer: e2e
priority: P1
phases: [P11]
status: blocked-impl-missing
blocked_reason: Service implementation chưa exist (TIER C). Cần impl service trước khi viết test.
created: 2026-04-30
estimated_effort_hours: 8
---

# TC-E2E-07 — PR-driven KB staleness cycle

## Mục tiêu
Verify khi PR merge, webhook trigger KB update: detect doc affected → LLM diff analysis → update embeddings → mark fresh.

## Pre-condition
- KB với 100 documents, mỗi doc có embedding
- GitLab webhook configured
- Doc-source mapping table populated

## Steps
1. Tạo PR thay đổi `auth/oauth.ts` (file đã có docs)
2. Merge PR → GitLab webhook fires
3. Webhook handler:
   - Identify affected docs (qua doc-source mapping)
   - LLM diff analysis: doc cần update không?
4. Verify `kb_doc_staleness` row tạo cho affected docs
5. Auto-draft update: agent đọc PR + old doc → propose new doc text
6. Approval item tạo cho human review
7. Approve → embeddings re-generated
8. Verify doc_staleness.fresh_at updated

## Expected
- Webhook fires < 5s sau merge
- LLM diff analysis xác định docs affected
- Auto-draft proposed
- Embeddings re-indexed sau approve

## Acceptance checklist
- [ ] Webhook handler not throw
- [ ] kb_doc_staleness rows tạo
- [ ] LLM proposed diff text non-empty
- [ ] approval_item tạo
- [ ] Sau approve: embeddings updated, kb_chunks rows refresh
- [ ] doc_staleness.fresh_at = now
- [ ] Test cả case: PR không affect docs (no-op)

## Implementation notes
**File:** `server/src/__tests__/e2e/kb-staleness-cycle.e2e.test.ts`

**Helpers:**
- `mockGitLabWebhook(prData)`
- `seedDocSourceMapping(docs, files)`
- `assertEmbeddingsRefreshed(docId)`

**Risk:**
- LLM diff analysis cần mock — dùng deterministic stub trả về propose
- Embedding regeneration tốn CPU — mock embedding model

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
