# Phase 1 — External Integrations + MCP Foundation

**Status:** in_progress
**Window:** 2-3 weeks
**Last updated:** 2026-04-29

> **Goal:** Build the bridge to the outside world. Without this, Phase 4 (Strategic Loop signals), Phase 8 (Greenfield repo scaffolding), Phase 11 (KB + Magika repo access), Phase 12 (Cross-repo) are all blocked.

---

## 1. Analysis (what already exists, what is missing)

### 1.1 Existing in paperclip
- `packages/mcp-server/` — **OUTBOUND** MCP server. It exposes Paperclip's REST API as an MCP server so external clients (Claude Desktop, Cursor, etc.) can manipulate Paperclip data. Not the bridge we need.
- `packages/db/src/schema/document_embeddings.ts` (migration `0074`) — embedding store scoped to `documents` rows, fixed model `nomic-embed-text`, real[] column.
- `packages/db/src/schema/company_secrets.ts` + `company_secret_versions` — secret storage we will reuse for MCP tokens.
- `@modelcontextprotocol/sdk@^1.29.0` is already in the workspace via `packages/mcp-server`.

### 1.2 Missing
- **INBOUND** MCP client framework (Paperclip agents calling external MCP servers).
- Registration/health/audit tables for external MCP servers.
- A **generic** embedding pipeline (entity-typed, not just documents).
- Adapter packages for GitLab MCP, OpenSearch MCP, Tavily/arXiv research.

### 1.3 Direction-of-flow recap
```
[Paperclip agent] ──MCP client──▶ [External MCP server: GitLab / OpenSearch / Research]
                  ◀──MCP server── [External LLM client: Claude Desktop / Cursor]
```
Phase 1 builds the **first arrow only**. The second arrow already exists.

---

## 2. Schema (added in this phase)

### 2.1 `mcp_servers` (NEW — migration `0076`)
Per-company MCP server registry. `company_id NULL` ⇒ platform-default registration.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `company_id` | uuid FK companies | NULL for platform defaults |
| `name` | text | display name (e.g. "GitLab Production") |
| `kind` | text | `gitlab` / `opensearch` / `research` / `runner` / `custom` |
| `transport` | text | `stdio` / `http+sse` / `websocket` |
| `endpoint` | text | URL or command for stdio |
| `auth_secret_id` | uuid | FK `company_secrets` (token resolution) |
| `status` | text | `enabled` / `disabled` / `degraded` |
| `config_json` | jsonb | adapter-specific options |
| `last_health_at` | timestamptz NULL | last successful health probe |
| `last_health_error` | text NULL | last failure reason |
| `created_at`, `updated_at` | timestamptz | |

Indexes: `(company_id, kind)`; `(status)`.

### 2.2 `mcp_tool_invocations` (NEW — migration `0077`)
Audit log of every tool call. Critical for cost / debugging / capability tracking.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `mcp_server_id` | uuid FK mcp_servers | |
| `company_id` | uuid FK companies | denormalised for fast filter |
| `agent_id` | uuid NULL | calling agent |
| `mission_id` | uuid NULL | calling mission/run |
| `tool_name` | text | |
| `request_json` | jsonb | redacted |
| `response_summary` | jsonb | `{ ok, status, byte_size }` (full body NOT stored) |
| `duration_ms` | int | |
| `error` | text NULL | |
| `occurred_at` | timestamptz | |

Indexes: `(company_id, occurred_at desc)`; `(mcp_server_id, occurred_at desc)`.

### 2.3 `entity_embeddings` (NEW — migration `0078`)
Generic embedding store, **superset** of `document_embeddings`. Keeps existing `document_embeddings` table untouched (avoid disruption); future code uses `entity_embeddings`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `company_id` | uuid FK companies | scope |
| `entity_type` | text | `document` / `issue` / `comment` / `feedback` / `rejection` / `signal` |
| `entity_id` | uuid | |
| `chunk_index` | int default 0 | |
| `chunk_text` | text | |
| `model` | text | e.g. `text-embedding-3-small` |
| `embedding` | real[] | 1536 dims (no pgvector dep — keeps PGlite parity) |
| `created_at` | timestamptz | |

Indexes: `(company_id, entity_type, entity_id)`; `(company_id, entity_type, created_at desc)`.

> **Decision:** Stay on `real[]` (matches `document_embeddings`) instead of `vector(1536)` so PGlite + Postgres run the same migrations. Cosine similarity via TS-side helper, not SQL operator. Revisit in Phase 11 if perf needs ANN search.

---

## 3. Packages added

```
packages/
├─ mcp-client/                    # NEW — generic MCP client base
│  ├─ src/
│  │  ├─ index.ts                 # public API
│  │  ├─ client.ts                # McpClient (transport + retry + breaker)
│  │  ├─ registry.ts              # McpRegistry (loads from mcp_servers table)
│  │  ├─ invocation-recorder.ts   # writes mcp_tool_invocations rows
│  │  ├─ circuit-breaker.ts
│  │  └─ types.ts
│  └─ src/__tests__/
├─ adapters/
│  ├─ gitlab-mcp/                 # NEW
│  │  └─ src/
│  │     ├─ tools.ts              # createBranch / pushCommit / openMR / pipelineStatus / listFiles / readFile / closeMR / commentOnMR / listProjects / getMR
│  │     └─ index.ts
│  ├─ opensearch-mcp/             # NEW
│  │  └─ src/
│  │     ├─ tools.ts              # queryLogs / evaluateAlertRule / aggregations
│  │     └─ index.ts
│  └─ research-mcp/               # NEW
│     └─ src/
│        ├─ tools.ts              # tavilySearch / arxivSearch / fetchPaper
│        └─ index.ts
└─ shared/
   └─ src/embeddings/             # NEW
      ├─ embed.ts                 # embed(text) → number[]
      ├─ embed-batch.ts
      ├─ cosine.ts                # cosineSimilarity / topK
      └─ providers/
         ├─ openai.ts
         └─ ollama.ts             # local fallback for sandbox
```

---

## 4. Server APIs

| Method | Path | Purpose |
| --- | --- | --- |
| GET  | `/api/companies/:id/mcp-servers` | list registered servers |
| POST | `/api/companies/:id/mcp-servers` | register new server |
| PATCH| `/api/mcp-servers/:id` | edit endpoint / status / config |
| DELETE | `/api/mcp-servers/:id` | soft-delete (status=disabled) |
| POST | `/api/mcp-servers/:id/health-check` | live probe |
| POST | `/api/mcp-servers/:id/invoke` | admin/test only — bypasses agents |

Auth: same bearer token as rest of Paperclip API. Write paths require `OWNER`/`ADMIN` membership of the company.

---

## 5. UI surface (deferred to Phase 7 polish)

For Phase 1 we expose the data via API only. A minimal **Settings → Integrations** tab (list / add / health badge / "Test invoke" panel) ships in Phase 7 alongside other admin UX. Document in `_index.md`.

---

## 6. Tests

| Layer | What | File |
| --- | --- | --- |
| Unit | `McpClient` retry + breaker + auth header | `packages/mcp-client/src/__tests__/client.test.ts` |
| Unit | `cosineSimilarity` numeric correctness | `packages/shared/src/embeddings/__tests__/cosine.test.ts` |
| Unit | Embedding provider mock returns 1536-dim vector | `packages/shared/src/embeddings/__tests__/embed.test.ts` |
| Schema | `mcp_servers` round-trip + soft-delete | `server/src/__tests__/mcp-servers.test.ts` |
| Schema | `mcp_tool_invocations` write + index lookup | `server/src/__tests__/mcp-invocations.test.ts` |
| Schema | `entity_embeddings` round-trip + filter by entity | `server/src/__tests__/entity-embeddings.test.ts` |
| Adapter | GitLab MCP `createBranch` happy path against fake server | `packages/adapters/gitlab-mcp/src/__tests__/branch.test.ts` |

CI uses an in-process fake MCP server (just an `McpServer` from the SDK with hand-rolled tool stubs) so we don't need a real GitLab.

---

## 7. Gate (must pass before closing Phase 1)

1. **Schema/migration**: `pnpm db:check:migrations` clean; `0076`, `0077`, `0078` listed in journal.
2. **Round-trip**: register a fake GitLab MCP → health-check returns ok → invoke `createBranch` writes a row in `mcp_tool_invocations`.
3. **Adapter**: GitLab adapter `createBranch + commitFile + openMR` returns success against the fake server.
4. **Embeddings**: `embed("hello")` returns `number[1536]` in <500ms (real call) or <50ms (mock).
5. **Audit**: `mcp_tool_invocations` row carries `duration_ms`, `request_json` (redacted), `response_summary`.
6. **Docs**: this file + `_index.md` updated; ADR-0010-MCP-Client-Framework written if any non-obvious decisions surface.

---

## 8. Out of scope (deferred)

- Real GitLab production tokens (developer brings their own in Phase 8).
- Runner MCP (compose / docker workspaces) — moved to Phase 7 alongside Dev Flow.
- pgvector ANN search — revisited in Phase 11.
- UI Integrations tab — Phase 7.
- Per-tool rate limits — global breaker only for now.

---

## 9. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| MCP SDK API drift between major versions | Pin `@modelcontextprotocol/sdk` to a single minor; track upgrade in ADR if needed |
| Stdio transport flaky in CI | All tests use in-memory `InMemoryTransport` from SDK |
| Embedding cost balloon in CI | Tests use deterministic mock provider; real OpenAI only behind `EMBED_PROVIDER=openai` env |
| `real[]` cosine perf on large tables | Phase 1 only loads <10k rows; ANN deferred to Phase 11 |

