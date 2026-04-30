---
id: TC-CP-12
name: KB cold-start bootstrap pipeline cho brownfield repo
layer: integration
priority: P1
phases: [P11]
status: implemented
implemented_at: 2026-04-30
test_file: server/src/kb-cold-start-bootstrap.integration.test.ts + tree-sitter
result: 21 pass
created: 2026-04-30
estimated_effort_hours: 6
---

# TC-CP-12 — KB cold-start bootstrap

## Mục tiêu
Verify cold-start ingestion: tree-sitter parse → ast-grep extract → embeddings → pgvector index.

## Pre-condition
- Sample brownfield repo (e.g., 100 TypeScript files)
- Embedding model mock
- pgvector extension enabled trong test DB

## Steps
1. Trigger `KBBootstrap.ingest(repoPath)` cho brownfield repo
2. Verify tree-sitter chunker extract symbols (functions, classes, types)
3. Verify ast-grep tags các pattern
4. Verify embeddings generated cho mỗi chunk
5. Verify pgvector index built
6. RAG query: "find auth handler" → return relevant chunks
7. Đo total bootstrap time + memory

## Expected
- Bootstrap < 5 phút cho 100 files
- RAG query trả về top-K chunks relevant
- Coverage gap detected (file types không được parse)

## Acceptance checklist
- [ ] kb_documents rows tạo cho mỗi file
- [ ] kb_chunks rows có embeddings
- [ ] pgvector index queryable
- [ ] RAG query precision ≥ 70% (top-3 relevant)
- [ ] Coverage gap reported (e.g., .json, .yaml không parse)
- [ ] Bootstrap time < 5 phút
- [ ] Memory peak < 500MB

## Implementation notes
**File:** `server/src/kb/__tests__/cold-start-bootstrap.integration.test.ts`

**Helpers:**
- `setupBrownfieldRepo(fileCount)`
- `runBootstrap(repoPath)`
- `ragQuery(text, topK)`

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
