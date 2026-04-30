# ADR-0010 — MCP Client Framework Lives Outside `mcp-server`

**Status:** Accepted
**Date:** 2026-04-29
**Owner:** Solo / Architecture
**Phase:** 1 — External Integrations

## Context

Paperclip already ships `packages/mcp-server/` which exposes Paperclip's REST
API as an **outbound** MCP server (so Claude Desktop / Cursor / external LLMs
can manipulate Paperclip data). Phase 1 of Custom Paperclip needs the
**inbound** direction: Paperclip's own agents must call **external** MCP
servers (GitLab, OpenSearch, Tavily/arXiv, future Runner). The two roles share
the same SDK (`@modelcontextprotocol/sdk`) but they are different lifecycles,
different transports, and different audit semantics.

### Constraints
- No fork: keep `packages/mcp-server/` untouched (it is published to npm under
  the same `@paperclipai/mcp-server` name).
- Phase 1 must produce a reusable client base for Phase 4 (Strategic Loop
  signals), Phase 8 (Greenfield repo scaffolding), Phase 11 (KB + Magika repo
  access), Phase 12 (Cross-repo coordination).
- Client must be testable without a real GitLab — CI runs in <1s.
- Audit trail (`mcp_tool_invocations`) is required for cost & calibration.

## Decision

Create a **new** workspace package `packages/mcp-client/` that is independent
of `packages/mcp-server/`.

```
@paperclipai/mcp-client          # generic client + retry + breaker + recorder
@paperclipai/gitlab-mcp          # typed wrapper around 10 GitLab tools
@paperclipai/opensearch-mcp      # typed wrapper for log/alert/aggregation tools
@paperclipai/research-mcp        # typed wrapper for Tavily + arXiv
```

Each adapter depends only on `@paperclipai/mcp-client` for the transport-agnostic
runtime; consumers (server, agents) wire transports + recorder.

### Key design points
1. **Transport-agnostic.** `McpClient` accepts a `transportFactory(registration) → Transport`
   so production wires `StdioClientTransport` / `SSEClientTransport`, tests
   wire `InMemoryTransport.createLinkedPair()` from the SDK.
2. **`isError` is failure.** When `client.callTool()` returns
   `{ isError: true }`, the framework converts that to a thrown error inside
   the retry loop so the breaker counts it. Plain protocol-level rejections
   are also retried.
3. **Recorder is best-effort.** `InvocationRecorder` writes to
   `mcp_tool_invocations`; a recorder failure must NEVER break the call site.
4. **Request redaction.** Keys matching `/token|secret|password|apiKey/i`
   are replaced with `"[redacted]"` before storage. Response **bodies** are
   never stored — only `{ ok, status, byteSize }`.
5. **Circuit breaker.** Opens after `failureThreshold` consecutive failures
   (default 5), then half-opens after `resetAfterMs` (default 30s). Open state
   throws `CircuitBreakerOpenError` synchronously without contacting the server.
6. **Static + DB loaders.** `StaticRegistryLoader` is for tests / bootstrap;
   the production loader (added in Phase 2 with WorkspaceContext) reads from
   `mcp_servers` via Drizzle.

### Why not extend `packages/mcp-server/`?
- Different deps surface (it ships as a published binary; we don't want
  client-only code in that package).
- Different test profile (its tests target REST mocks; ours target
  `InMemoryTransport`).
- Different release cadence — adapters will iterate weekly while the outbound
  server is stable.

## Consequences

### Positive
- Phase 4/8/11/12 each consume one or more adapters as a workspace dep —
  no copy-paste of MCP boilerplate.
- Zod-typed inputs guarantee callers never send malformed payloads.
- Audit + breaker + retry are universal across adapters.

### Negative / risks
- Three new packages = three more `package.json`s to keep in sync. Mitigation:
  share `tsconfig.base.json`; lint rule pinning `@modelcontextprotocol/sdk` is
  added in Phase 14a.
- The MCP SDK is pre-1.0; minor-version drift could break us. Mitigation:
  `@modelcontextprotocol/sdk@^1.29` pinned, surface upgrades via ADR.

## Alternatives considered

1. **Single `packages/mcp/` package.** Rejected — couples server + client tests
   and forces every consumer to pull both transports.
2. **Per-adapter direct SDK use (no `mcp-client`).** Rejected — duplicates
   retry/breaker/recorder across 4+ adapters; cost auditing becomes inconsistent.
3. **HTTP-only via `paperclipApiRequest` from `mcp-server`.** Rejected — that
   is a Paperclip-specific escape hatch, not an external MCP transport.

## Validation (Phase 1 close-out)

- `packages/mcp-client` — 11 tests pass (retry, breaker, recorder, redaction,
  health, listTools).
- `packages/adapters/gitlab-mcp` — 3 tests pass (createBranch +
  commitFile + openMR end-to-end against fake server).
- `packages/adapters/opensearch-mcp` — typecheck clean.
- `packages/adapters/research-mcp` — typecheck clean.
- `server/src/__tests__/mcp-schema.test.ts` — 4 tests pass (mcp_servers,
  mcp_tool_invocations, entity_embeddings, cascade delete).

## Links
- Phase 1 plan: [[Phases/Phase-1-External-Integrations]]
- Master plan: [[Implementation-Master-Plan]]
- Outbound counterpart: `packages/mcp-server/README.md`
