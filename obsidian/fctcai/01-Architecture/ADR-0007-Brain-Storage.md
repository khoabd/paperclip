# ADR-0007: Brain Storage via `documents` (key='brain')

**Status**: Accepted
**Date**: 2026-04-29

## Context

`Autonomous-PM-Strategic-Loop-Design` and `Greenfield-Bootstrap-Design` introduce a per-project **Brain**: a long-lived structured artifact that captures vision, personas, principles, decisions, current state, north-star metric, glossary, and recent learnings. The Strategic Loop reads it every cycle; auditors update it; ADRs and rejection learnings amend it.

Requirements:
- Versioned (need to inspect "what did the brain look like during decision X").
- Embeddable (RAG-searchable for agents).
- Editable by both LLM and human.
- One per workspace (project).

Paperclip already ships:
- `documents` — top-level document table, scoped per company, addressable by `key` (free-form string).
- `documentRevisions` — full version history, every save creates a row.
- `documentEmbeddings` — vector store keyed off doc/revision.
- `issueDocuments` — links a document into an issue thread.

Candidates considered:
- A. Add a dedicated `brains` table.
- B. **Reuse `documents` with a reserved `key='brain'` per company.**
- C. Store brain as JSON inside `companies.metadata`.

## Decision

**Option B — reuse `documents`** with the convention:
- `key = 'brain'`
- `companyId = <workspace>`
- `kind = 'brain/markdown'`
- One row per workspace; updates create new `documentRevisions`.

Sections inside the brain (vision, personas, principles, etc.) are H2 markdown headings parsed by a small `BrainParser` helper, not separate tables. RAG queries hit `documentEmbeddings` filtered to `kind='brain/markdown'`.

## Rationale

- **Versioning, audit, and embedding for free** — `documentRevisions` already gives us byte-perfect history; `documentEmbeddings` already does the RAG indexing.
- **Editor reuse** — the existing document editor in the UI works on the brain unchanged.
- **Permissions reuse** — document RBAC and audit log already exist.
- **Zero schema additions** — Phase-0 deliverable.
- **Markdown is the right shape**: humans, LLMs, and diffs all handle it well.

## Consequences

- ✅ "Show me the brain at the time of decision X" = `SELECT * FROM document_revisions WHERE document_id = ? AND created_at <= ? ORDER BY created_at DESC LIMIT 1`.
- ✅ Strategic Loop reads brain via `documents.findByKey(companyId, 'brain')` and edits via `documentRevisions.append()`.
- ⚠️ The brain is one large document; structured queries like "what is the north-star metric?" require a parse pass. Mitigation: `BrainParser` exposes a typed `BrainModel` with cached structured fields; cache invalidates on revision.
- ⚠️ Concurrent edits need optimistic locking (revision number conflict → retry). Documents already support this via `revisionNumber`.

## Sub-keys for sub-artifacts

For artifacts that are too large to keep inside the main brain, we use sibling keys with a stable namespace:
- `key='brain'` — main brain
- `key='brain/personas'` — persona deck
- `key='brain/principles'` — principles register (auto-amended by Rejection Learning)
- `key='brain/glossary'` — glossary
- `key='brain/decisions'` — decision log (linked to ADRs and approval rows)

The Strategic Loop treats `brain` as the authoritative pointer; sub-artifacts are linked from there with wiki-style references.
