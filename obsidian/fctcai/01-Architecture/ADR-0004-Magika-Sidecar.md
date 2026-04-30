# ADR-0004: Magika File Triage as Python Sidecar Plugin

**Status**: Accepted
**Date**: 2026-04-29

## Context

`Magika-Integration-and-Codebase-Triage` requires Google Magika (deep-learning file-type classifier) to:
- Inventory brownfield codebases (file-type breakdown, language drift)
- Filter vendored / generated / binary content out of RAG indexing
- Detect supply-chain anomalies (e.g., `.sh` mislabelled as `.txt`)

Magika ships as a Python package (`pip install magika`) backed by an ONNX model. Native JS port does not exist; running ONNX in Node is feasible but means re-implementing Magika's preprocessing.

Candidates:
- A. `onnxruntime-node` + manually port preprocessing (high risk, drift from upstream)
- B. Spawn `magika` CLI per-file (slow: ~80ms cold start × thousands of files)
- C. Long-running Python sidecar speaking HTTP/JSON over loopback
- D. Skip Magika; use file-extension + first-bytes heuristics

## Decision

**Option C — Python sidecar plugin** registered through paperclip's existing plugin system (`packages/plugins/`). The plugin exposes `POST /classify` and `POST /classify-batch` over loopback, hot-loads the Magika model once, returns `{label, score, group, mime_type}`.

Plugin name: `plugin-magika`. Boot from `packages/plugins/plugin-magika/` with a `pyproject.toml` and a thin Node wrapper that supervises the Python process via `child_process.spawn`. Health surfaced through the existing `pluginState` table; failures route through the existing watchdog.

## Rationale

- **Upstream fidelity**: we get every Magika model bump for free with `pip install -U magika`.
- **Latency**: batch endpoint amortizes one inference call across N files; cold start paid once.
- **Crash isolation**: a Magika OOM does not kill the Node process.
- **Reuse plugin contract**: paperclip already has `plugins`, `pluginConfig`, `pluginState`, `pluginJobs`, `pluginLogs` — we add zero new infra.
- **Future portability**: when an equivalent JS classifier exists, swap the plugin without changing callers.

## Consequences

- ✅ Magika triage usable across all greenfield/brownfield bootstrap flows.
- ✅ Memory bounded (~500MB resident for the model, single process).
- ✅ Failures degrade gracefully — fall back to extension heuristics.
- ⚠️ Adds a Python runtime dependency to the dev environment (mitigation: optional plugin; ship the binary in a Docker layer for prod).
- ⚠️ Loopback HTTP adds ~1ms per call (acceptable; we batch).
- ⚠️ Operators must run `pip install` once (mitigation: `pnpm setup:plugins` script handles it).

## Interface

```ts
// packages/shared/src/magika.ts
export interface MagikaResult {
  label: string;       // "javascript", "python", "binary", ...
  score: number;       // 0..1
  group: string;       // "code" | "text" | "binary" | "media" | ...
  mimeType: string;
}

export async function classify(buf: Buffer): Promise<MagikaResult>;
export async function classifyBatch(files: { id: string; buf: Buffer }[]): Promise<Record<string, MagikaResult>>;
```

The plugin registers as a callable adapter; downstream RAG splitter and supply-chain scanner just `import { classify } from "@paperclip/shared/magika"`.
