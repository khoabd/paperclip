---
tags: [architecture, integration, magika, brownfield, triage, security]
date: 2026-04-29
priority: P0
---

# Magika Integration & Codebase Triage

> **Mục đích:** Tích hợp Google Magika (deep-learning file-type identifier) vào Paperclip để giải quyết thử thách lớn nhất: nhận một dự án có sẵn với codebase khổng lồ (50k–5M files) và **không có docs**. Magika cho phép Paperclip "nhìn thấy" toàn bộ repo trong vài phút với độ chính xác cao, tạo nền tảng cho mọi bước phân tích sau.

---

## 1. Vấn đề: Brownfield với Source Code Khổng Lồ, Không Docs

Khi Paperclip nhận 1 repo legacy 10 năm tuổi:

| Đặc điểm | Hệ quả |
|----------|--------|
| 500k–5M files | Không thể đọc toàn bộ bằng LLM (cost vô hạn, context overflow) |
| Mix nhiều language (Python + JS + Go + Cobol legacy) | Single tree-sitter grammar không đủ |
| File không có extension (Makefiles, scripts, generated) | Extension-based detection sai |
| Vendored deps (`node_modules`, `vendor/`, `third_party/`) chiếm 70-90% | Tốn tài nguyên parse những thứ không phải mã của org |
| Generated code (proto stubs, GraphQL codegen, ORM models) | Trùng nội dung, không phản ánh design intent |
| Binary lẫn trong source dirs (compiled assets, fonts, cached data) | Embed model fail, security risk |
| Disguised files (executable đặt tên `.png`) | Supply-chain attack vector |
| Misnamed files (`.txt` chứa SQL, `.json` chứa YAML) | Parser sai → KB sai |

**Hệ quả nếu không xử lý:** Bootstrap pipeline dùng tree-sitter+LLM trên toàn repo:
- Tốn $$$ (token cost cho cả vendored + generated)
- Mất hàng giờ/ngày
- KB bị nhiễm bởi 3rd-party code, không phản ánh business logic
- RAG retrieve sai (tìm "user authentication" trả ra code của Express middleware)

**Yêu cầu:** Pre-filter + classify toàn bộ files trong < 30 phút, độ chính xác > 99%, runs offline (không gửi source code lên cloud).

---

## 2. Tại sao chọn Magika

| Tiêu chí | Magika | `file` (Unix) | python-magic | tree-sitter | extension-based |
|----------|--------|---------------|--------------|-------------|-----------------|
| Accuracy on real-world | ~99%+ | ~70% | ~75% | requires lang | ~60% |
| Files/sec | ~10,000+ | ~5,000 | ~3,000 | ~50 | ∞ |
| Identifies content type, not just extension | ✅ | ⚠️ partial | ⚠️ partial | ❌ | ❌ |
| Identifies misnamed/disguised files | ✅ | ❌ | ❌ | ❌ | ❌ |
| Distinguishes source vs generated | ✅ heuristic | ❌ | ❌ | ❌ | ❌ |
| Hundreds of file types | ✅ (200+) | ✅ | ✅ | ❌ (per-grammar) | ❌ |
| Runs offline / on-prem | ✅ | ✅ | ✅ | ✅ | ✅ |
| Open source (Apache 2.0) | ✅ | ✅ | ✅ | ✅ | — |
| Easy Python/CLI integration | ✅ | ✅ | ✅ | ✅ | — |
| Confidence score per file | ✅ | ❌ | ❌ | ❌ | ❌ |
| Maintained by | Google | community | community | community | — |

**Verdict:** Magika là tool đầu tiên trong pipeline trước mọi parser khác. Không thay thế tree-sitter mà **bổ sung phía trước**: Magika nói "đây là Python, độ tin 99.8%" → tree-sitter mới được kích hoạt với grammar đúng.

---

## 3. Vị trí trong Kiến trúc Paperclip

Magika được tích hợp vào **5 điểm**, theo thứ tự priority:

```
┌─────────────────────────────────────────────────────────────┐
│ ① BROWNFIELD COLD START (KB §3) — chính, P0                 │
│    Scan toàn repo → triage → KB chỉ index source thật       │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ ② SECURITY SCANNING (Auto Ops §5) — P0                      │
│    Detect smuggled binaries, disguised files                │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ ③ PR GATE — supply chain check (Dev Flow + Auto Ops) — P1   │
│    Block PRs adding suspicious files                        │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ ④ GREENFIELD INTAKE (Greenfield §3.1) — P1                  │
│    Classify uploaded attachments (Figma export, PRD, etc.)  │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ ⑤ RAG INDEXING (KB §7) — P1                                 │
│    Route to right splitter/embedder per file type           │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Brownfield Cold-Start Triage Pipeline (Detail)

### 4.1 Pipeline phases

```
Input: Repo URL (GitLab MCP)
   │
   ▼
┌───────────────────────────────────────────────────────────┐
│ PHASE 0 — Repo Snapshot                                   │
│ - Shallow clone via GitLab MCP                            │
│ - Compute total file count, total bytes, age, contributor │
│ - Output: repo_snapshot.json                              │
└───────────────────────────────────────────────────────────┘
   │
   ▼
┌───────────────────────────────────────────────────────────┐
│ PHASE 1 — Magika Scan (PARALLEL, ~10k files/sec)          │
│ - Run magika on every file                                │
│ - Capture: file_path, mime, content_type, group, score    │
│ - Output: file_inventory table populated                  │
│ - Time budget: 30 min for 10M files                       │
└───────────────────────────────────────────────────────────┘
   │
   ▼
┌───────────────────────────────────────────────────────────┐
│ PHASE 2 — Triage Classification                           │
│ Each file → one of these buckets:                         │
│   • source_code   (will be parsed by tree-sitter)         │
│   • config        (parsed for env / deps / secrets)       │
│   • docs          (indexed into RAG as prose)             │
│   • test          (separate index, lower priority)        │
│   • generated     (skip — diff against codegen output)    │
│   • vendored      (skip — but record dep version)         │
│   • build_artifact (skip — should not be in repo)         │
│   • binary_asset  (skip parsing, register existence)      │
│   • suspicious    (flag for security review)              │
│   • unknown       (flag for human triage)                 │
└───────────────────────────────────────────────────────────┘
   │
   ▼
┌───────────────────────────────────────────────────────────┐
│ PHASE 3 — Triage Report                                   │
│ - Histograms: by language, by bucket, by directory        │
│ - "Hot zones" — directories with most source code         │
│ - "Cold zones" — vendored/build artifacts to skip         │
│ - Anomalies: binaries in src/, disguised files, etc.      │
│ - Output: triage_report.md → human review (Approval Gate) │
└───────────────────────────────────────────────────────────┘
   │
   ▼
┌───────────────────────────────────────────────────────────┐
│ PHASE 4 — Filtered Tree-sitter + RAG Indexing             │
│ - Only `source_code` + `config` + `docs` buckets parsed   │
│ - Tree-sitter grammar selected per Magika label           │
│ - RAG embeds code/prose with appropriate splitter         │
│ - Reduces parse cost by typically 80-95%                  │
└───────────────────────────────────────────────────────────┘
```

### 4.2 Bucket classification rules

```python
def classify_bucket(magika_result, file_path) -> str:
    label = magika_result.label              # e.g. "python", "typescript", "json"
    group = magika_result.group              # e.g. "code", "text", "binary"
    score = magika_result.score              # confidence 0-1
    path  = file_path

    # Vendored / dependency directories (path-based)
    VENDOR_DIRS = {"node_modules", "vendor", "third_party", ".venv",
                   "venv", "site-packages", "bower_components", "deps"}
    if any(seg in VENDOR_DIRS for seg in path.parts):
        return "vendored"

    # Build artifacts
    BUILD_DIRS = {"dist", "build", "out", "target", ".next", ".nuxt",
                  "__pycache__", ".gradle", "bin", "obj"}
    if any(seg in BUILD_DIRS for seg in path.parts):
        return "build_artifact"

    # Generated code (heuristic: has codegen marker)
    if has_codegen_marker(file_path):  # "DO NOT EDIT", "@generated", proto/grpc patterns
        return "generated"

    # Suspicious: file content type ≠ extension
    if extension_mismatch(label, file_path.suffix) and group == "binary":
        return "suspicious"

    # Standard groups
    if group == "code":
        if "test" in path.parts or path.stem.endswith(("_test", ".test", ".spec")):
            return "test"
        return "source_code"

    if label in {"json", "yaml", "toml", "ini", "properties", "xml"}:
        return "config"

    if group == "text" and label in {"markdown", "rst", "html", "txt", "asciidoc"}:
        return "docs"

    if group == "binary":
        return "binary_asset"

    return "unknown"
```

### 4.3 Anomaly detection

```python
def detect_anomalies(file_inventory):
    anomalies = []

    # Binaries in source dirs
    for f in file_inventory:
        if f.bucket == "binary_asset" and "src" in f.path.parts:
            anomalies.append(("binary_in_src", f, "high"))

    # Extension mismatch (executable disguised as image, etc.)
    for f in file_inventory:
        if f.suspicious_disguise:
            anomalies.append(("disguised_file", f, "critical"))

    # Massive single file (might be minified bundle)
    for f in file_inventory:
        if f.size > 5_000_000 and f.bucket == "source_code":
            anomalies.append(("oversized_source", f, "medium"))

    # Multiple languages mixing (language drift)
    by_dir = group_by_dir(file_inventory)
    for d, files in by_dir.items():
        langs = {f.label for f in files if f.bucket == "source_code"}
        if len(langs) > 3:
            anomalies.append(("language_drift", d, "low"))

    return anomalies
```

---

## 5. Magika Service — Architecture

### 5.1 Service shape

```
┌─────────────────────────────────────────────────┐
│  magika-service  (Python, gRPC + REST)          │
│                                                  │
│  ┌─────────────────────────────────────────┐   │
│  │ /scan-file        (POST: bytes → label)  │   │
│  │ /scan-paths       (POST: list → labels)  │   │
│  │ /scan-repo        (POST: dir → inventory)│   │
│  │ /health                                   │   │
│  └─────────────────────────────────────────┘   │
│                                                  │
│  Backend: Magika library (Python or ONNX)       │
│  Runtime: CPU (no GPU needed)                    │
│  Container: 200MB image                          │
└─────────────────────────────────────────────────┘
```

Deployed as K8s deployment (3 replicas, HPA on CPU).

### 5.2 Batch API (high-throughput)

For repo scan:
```
POST /scan-repo
{
  "repo_path": "/workspace/abc123/myrepo",
  "exclude_globs": [".git/**", "node_modules/**"],
  "parallelism": 16,
  "min_confidence": 0.5
}

→ Streaming JSONL response:
{"path": "src/main.py", "label": "python", "group": "code", "score": 0.998, "size": 1234}
{"path": "vendor/lib.so", "label": "elf", "group": "binary", "score": 0.999, "size": 99999}
...

Trailer:
{"summary": {"total_files": 1234567, "elapsed_ms": 1850000, "errors": 3}}
```

### 5.3 Caching

Magika results cached by `(content_hash, file_size)`:
```sql
CREATE TABLE magika_cache (
  content_hash TEXT PRIMARY KEY,
  file_size BIGINT,
  label TEXT,
  group_name TEXT,
  score NUMERIC,
  scanned_at TIMESTAMPTZ DEFAULT NOW()
);
```

Re-scan only when content_hash changes → on subsequent commits, only delta files scanned.

---

## 6. Database Schema

```sql
CREATE TABLE file_inventory (
  id BIGSERIAL PRIMARY KEY,
  repo_id UUID NOT NULL,
  scan_id UUID NOT NULL,
  path TEXT NOT NULL,
  size_bytes BIGINT,
  content_hash TEXT,
  magika_label TEXT,                  -- python, typescript, json, png, ...
  magika_group TEXT,                  -- code, text, binary, audio, ...
  magika_score NUMERIC,               -- 0.0-1.0 confidence
  bucket TEXT,                        -- source_code, vendored, generated, ...
  flags TEXT[],                       -- [disguised, oversized, ...]
  scanned_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_inventory_bucket ON file_inventory (repo_id, bucket);
CREATE INDEX idx_inventory_label  ON file_inventory (repo_id, magika_label);

CREATE TABLE triage_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL,
  scan_id UUID NOT NULL,
  total_files INT,
  total_bytes BIGINT,
  bucket_counts JSONB,                -- {"source_code": 12000, "vendored": 350000, ...}
  language_histogram JSONB,           -- {"python": 8000, "typescript": 4000, ...}
  hot_zones JSONB,                    -- top dirs by source_code count
  cold_zones JSONB,                   -- top dirs to skip
  anomalies JSONB,
  approval_id UUID,                   -- human gate ref
  approved BOOLEAN,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 7. Use Case Examples

### 7.1 Use case A — Legacy monolith (5M files, 15 years)

```
Scan stats:
  Total files:      5,200,000
  Magika time:      ~12 min (parallelism=64)
  Total bytes:      85GB

Bucket breakdown:
  vendored:         3,640,000 (70%)
  build_artifact:     520,000 (10%)
  generated:          312,000 (6%)
  source_code:        468,000 (9%)
  config:             156,000 (3%)
  docs:                52,000 (1%)
  binary_asset:        46,800 (1%)
  suspicious:               7
  unknown:              5,193

→ Tree-sitter parse only ~530k files instead of 5.2M
→ Cost reduction: ~90%
→ KB index reflects only org's actual code
```

### 7.2 Use case B — Suspicious file detected

```
Magika finds:
  path: assets/logo.png
  label: pe_executable    ← !!
  group: binary
  score: 0.987

→ Flag as `disguised_file`, severity=critical
→ Block in triage_report
→ Notify security agent
```

### 7.3 Use case C — Language drift

```
src/api/payments/ has:
  - 12 .ts files (TypeScript)
  - 3 .py files (Python)         ← unexpected
  - 1 .rb file (Ruby legacy)     ← unexpected

→ Anomaly: language_drift in src/api/payments/
→ Triage report: "Inconsistent language mix in API module"
→ Potential migration debt or vendored snippet
```

---

## 8. Integration Points (Updates to Existing Docs)

| Existing doc | Change needed |
|-------------|---------------|
| Knowledge-Base-Management-Strategy §3 | Replace "Discovery" stage with Magika triage as Phase 0; tree-sitter only on `source_code` + `config` |
| Autonomous-Operations-and-Human-Gate-Design §5 (Security) | Add `disguised_file` rule; PR pre-merge security gate runs Magika on changed files |
| Development-Flow-and-Release-Strategy §3 (Conflict Detection) | Add binary-in-src as conflict signal |
| External-Integrations-and-Environment-Strategy §6 (CI/CD) | Add `magika-scan` job in PR pipeline (fast: <30s on changed files) |
| Greenfield-Bootstrap-Design §3.1 | Magika classifies uploaded attachments before LLM analysis |
| UX-Strategy-and-Design §5 (Screen Designs) | Add "Triage Report" screen for brownfield approval |

---

## 9. Cost & Performance

| Metric | Estimate |
|--------|---------|
| Throughput | ~10,000 files/sec on 16-core CPU |
| Memory | ~500MB resident for service |
| 1M files scan | ~1.5 min |
| 10M files scan | ~15 min |
| Re-scan after delta | seconds (cache hit) |
| Cost per repo scan | <$0.10 (CPU compute, no LLM tokens) |
| Accuracy on common types | >99% |
| Accuracy on rare/legacy types | ~90-95% |

**Net effect on bootstrap:**
- Without Magika: scan 5M files with tree-sitter+LLM → ~$200-500 + 2-5 days
- With Magika: filter to ~500k → ~$20-50 + 4-8 hours
- **Savings: 85-95% in cost and time**

---

## 10. Implementation Roadmap

### Phase 0 — Magika Service (3 days)
- [ ] Containerize `magika-service` (Python + gRPC/REST)
- [ ] K8s deployment + HPA
- [ ] `/scan-file`, `/scan-paths`, `/scan-repo` endpoints
- [ ] Streaming JSONL response

### Phase 1 — Triage Pipeline (4 days)
- [ ] `file_inventory`, `triage_reports`, `magika_cache` tables
- [ ] Bucket classification engine
- [ ] Anomaly detector
- [ ] Triage report generator (Markdown)
- [ ] Approval Center integration

### Phase 2 — KB Cold Start Wiring (3 days)
- [ ] KB §3 Discovery replaced with Magika first-pass
- [ ] Tree-sitter restricted to `source_code` + `config` buckets
- [ ] Per-label grammar selection logic

### Phase 3 — Security PR Gate (2 days)
- [ ] PR-changed-files Magika scan in CI
- [ ] Block on `suspicious` / `disguised_file`
- [ ] Slack notification + audit log

### Phase 4 — RAG Routing (2 days)
- [ ] LlamaIndex code splitter for `code` group
- [ ] Text splitter for `text` group
- [ ] Skip `binary` group entirely

### Phase 5 — Greenfield Intake (1 day)
- [ ] Magika scan uploaded attachments
- [ ] Pre-classify before LLM analysis

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Magika misclassifies novel/proprietary file types | Cache + manual override in `file_inventory.bucket`; human can re-bucket |
| Service becomes bottleneck on huge repos | HPA + parallelism param; can run as job (not service) for one-shot scans |
| Magika model updates change classifications | Pin model version in container; re-scan only when model upgraded explicitly |
| False positives on `suspicious` bucket | Confidence threshold + human review gate before blocking |
| Vendored detection misses edge case (e.g. `external/` dir) | User-configurable VENDOR_DIRS list per project |

---

## 12. Liên kết

- [[Knowledge-Base-Management-Strategy#3. Cold Start]] — Phase 0 thay thế bằng Magika
- [[Greenfield-Bootstrap-Design#3.1 Stage 1]] — Magika cho file uploads
- [[Autonomous-Operations-and-Human-Gate-Design#5. Security Scanning]] — extension mismatch detection
- [[Development-Flow-and-Release-Strategy#3. Conflict Detection]] — binary-in-src signal
- [[External-Integrations-and-Environment-Strategy#6. Revised CI/CD]] — magika-scan job
