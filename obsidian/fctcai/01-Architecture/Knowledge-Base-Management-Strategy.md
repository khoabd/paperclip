---
title: Knowledge Base Management Strategy — Multi-Repo & Technical Documentation
tags: [architecture, knowledge-base, documentation, multi-repo, ai-agents, strategy]
created: 2026-04-29
status: design
related: "[[Autonomous-PM-Strategic-Loop-Design]]"
---

# Knowledge Base Management Strategy
## Multi-Repo, Technical Documentation, và Documentation Automation

> Thiết kế chiến lược quản lý toàn bộ kiến thức kỹ thuật của một dự án: từ lúc Paperclip nhận một project chưa có gì, qua quá trình khám phá tự động, đến duy trì và đảm bảo mọi thứ luôn được document hoá trong suốt vòng đời phát triển.

---

## 1. Tổng quan — 3 Giai đoạn Vòng đời

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   COLD START     │───▶│   DEVELOPMENT    │───▶│   MAINTENANCE    │
│  (Bootstrap)     │    │  (Continuous)    │    │  (Audit/Repair)  │
│                  │    │                  │    │                  │
│ Project nhận vào │    │ Mỗi PR merged    │    │ Weekly audit     │
│ chưa có gì       │    │ → detect changes │    │ → find gaps      │
│ → tự động khám   │    │ → update docs    │    │ → auto-fix       │
│   phá và ghi lại │    │ → flag stale     │    │ → human review   │
└──────────────────┘    └──────────────────┘    └──────────────────┘
```

---

## 2. Tool Stack — Lựa chọn cuối cùng

Dựa trên research 2024-2025, ưu tiên: **open-source, self-hosted, LangChain-native**.

| Layer | Tool | Lý do chọn |
|-------|------|-----------|
| **Code Parsing** | `tree-sitter` | Multi-language AST, embeddable, LangChain loaders có sẵn |
| **Code Search** | `ast-grep` | Structural search theo pattern — tìm route handlers, model defs |
| **API Spec Extraction** | `Optic` + `TypeSpec` | Optic detect breaking changes; TypeSpec cho design-first |
| **Diagram Generation** | `Mermaid` (primary) + `D2lang` (complex) | LLMs tự generate Mermaid natively; D2 cho architecture phức tạp |
| **Knowledge Graph** | Custom graph trên PostgreSQL + `pgvector` | Đã có Postgres, tránh thêm infra; đủ cho scale hiện tại |
| **Vector RAG** | `pgvector` + `LlamaIndex code splitters` | Self-hosted, LangChain native, AST-aware chunking |
| **Doc Automation** | `Swimm` concept (self-built) + `Mintlify` (public) | Swimm quá đắt → build lightweight version; Mintlify cho public API |
| **Staleness Detection** | GitHub/GitLab webhooks + LLM diff analysis | Zero extra infra — dùng webhook đã có |

**Không dùng**: Sourcegraph (enterprise price), Graphite (PR-only), Speakeasy (SDK focus).

---

## 3. Cold Start — Bootstrap Pipeline

> Khi Paperclip nhận một project hoàn toàn mới, chưa có doc nào, chưa biết codebase là gì.

### 3.1 Trigger

- User thêm repos vào `project_repos`
- Hoặc: user import từ GitHub org (bulk)
- Bootstrap Pipeline tự động khởi chạy

### 3.2 Full Bootstrap Flow

```
INPUT: repo URLs
    │
    ▼
[Phase 1: Discovery]          ~5-10 phút/repo
    ├── Clone / shallow fetch repo
    ├── Detect language + framework (package.json, pyproject.toml, go.mod...)
    ├── tree-sitter scan → extract:
    │     • All route/endpoint definitions
    │     • All database model/schema definitions
    │     • All event publish/subscribe calls
    │     • All external HTTP client calls (fetch, axios, requests...)
    │     • All import/dependency relationships
    └── Kết quả: raw_codebase_map (JSON)
    │
    ▼
[Phase 2: Relationship Mapping]
    ├── Match HTTP calls across repos → build repo_dependencies
    ├── Match event producers ↔ consumers → build event_flow graph
    ├── Match shared DB schemas → flag shared_db dependencies
    └── Kết quả: dependency_graph populated
    │
    ▼
[Phase 3: Spec Generation]    ~LLM per repo
    ├── From extracted routes → generate OpenAPI spec (YAML)
    ├── From DB models → generate ERD (Mermaid)
    ├── Per-service: generate component diagram (Mermaid)
    └── Save to api_specs + tech_docs
    │
    ▼
[Phase 4: Flow Generation]    ~LLM per feature cluster
    ├── Group endpoints by feature tag (auth, payment, order...)
    ├── Per feature: generate sequence diagram from call chains
    ├── Cross-service flows: generate integration flow diagrams
    └── Save to tech_docs (type: sequence_flow, integration_flow)
    │
    ▼
[Phase 5: Architecture Doc]
    ├── LLM reads all repos + dep graph
    ├── Generate system architecture overview (C4 Level 1+2 in Mermaid)
    ├── Generate deployment topology doc
    └── Save to tech_docs (type: system_architecture)
    │
    ▼
[Phase 6: Gap Detection]
    ├── Compare generated docs vs completeness checklist
    ├── Flag: repos missing runbook, services missing ADR...
    ├── Populate doc_coverage_gaps
    └── Generate "Bootstrap Report" cho human review
    │
    ▼
OUTPUT: Fully populated Knowledge Base (draft quality)
        + Bootstrap Report for human review/correction
```

### 3.3 Bootstrap Report (human review)

```
=== BOOTSTRAP REPORT — Project: ATO ===
Generated: 2026-04-29 14:32

📦 REPOS DISCOVERED (3)
  ✅ payment-service    (TypeScript/Express, 847 files)
  ✅ order-service      (Python/FastAPI, 423 files)
  ✅ frontend           (React/TypeScript, 1,204 files)

🔗 DEPENDENCIES FOUND (7)
  ✅ frontend → payment-service  (HTTP: POST /payments, GET /payments/:id)
  ✅ frontend → order-service    (HTTP: POST /orders, GET /orders)
  ✅ order-service → payment-service (HTTP: POST /payments/charge)
  ⚠️  payment-service → [unknown-service]:8080  ← cannot resolve, manual check needed
  ...

📄 DOCS GENERATED (18)
  API Specs:     3  (one per service)
  ERDs:          2  (payment-service, order-service)
  Sequence flows: 5 (auth, checkout, payment, order-status, refund)
  Architecture:   1 (system overview)
  Component:      3 (one per service)

⚠️  NEEDS HUMAN REVIEW (4)
  • payment-service calls unknown host :8080 — what is this?
  • order-service has 3 undocumented endpoints (no route comments found)
  • frontend has 2 env vars with no description (VITE_UNKNOWN_KEY_1, VITE_UNKNOWN_KEY_2)
  • No runbook exists for any service — recommend creating

📊 CONFIDENCE SCORES
  API Specs:      82% — good route coverage
  ERDs:           91% — full schema extracted
  Sequence flows: 68% — some async flows unclear (manual review recommended)
  Architecture:   75% — overall structure clear, some deployment details missing

👉 Review generated docs: /ATO/knowledge-base
```

### 3.4 LLM Prompts — Key Bootstrap Nodes

**Spec Generation từ Routes:**
```typescript
async function generateApiSpec(repo: Repo, routes: ExtractedRoute[]): Promise<string> {
  return await llm.invoke([
    new SystemMessage(`You are a senior API architect.
    Generate a complete OpenAPI 3.0 YAML spec from these extracted route handlers.
    
    Rules:
    - Infer request/response schemas from parameter names and types
    - Mark endpoints as deprecated if handler name contains 'legacy' or 'deprecated'
    - Add realistic descriptions based on route path and HTTP method
    - Group by tags based on path prefix (/payments → tag: payments)
    - If a field type is unclear, use 'string' with a note
    
    Service: ${repo.name}
    Framework: ${repo.framework}
    Base path: ${repo.basePath}`),
    new HumanMessage(JSON.stringify(routes)),
  ]);
}
```

**Sequence Flow từ Call Chain:**
```typescript
async function generateSequenceFlow(feature: string, callChain: CallChain[]): Promise<string> {
  return await llm.invoke([
    new SystemMessage(`Generate a Mermaid sequence diagram for this feature.
    
    Output ONLY valid Mermaid sequenceDiagram syntax.
    Include: actors (services/clients), messages, response arrows, alt/opt blocks for error paths.
    Be thorough — include auth headers, error responses, async callbacks.`),
    new HumanMessage(`Feature: ${feature}\nCall chain:\n${JSON.stringify(callChain)}`),
  ]);
}
```

---

## 4. Continuous Update Pipeline

> Trong quá trình phát triển, mỗi khi code thay đổi — Knowledge Base tự động cập nhật.

### 4.1 Trigger Events

| Event | Source | What to do |
|-------|--------|-----------|
| PR merged | GitHub webhook | Scan changed files, update affected docs |
| New route added | PR diff analysis | Generate/update API spec entry |
| DB migration merged | PR diff (alembic/drizzle) | Regenerate ERD section |
| New service added | `project_repos` insert | Run mini-bootstrap for that repo |
| Issue marked done | Paperclip webhook | Check if impl matches doc; update if needed |
| Dependency changed | package.json / requirements.txt | Re-scan import graph |

### 4.2 PR-Driven Doc Update Flow

```typescript
async function onPrMerged(pr: PullRequest) {
  const changedFiles = await getPrDiff(pr);

  // Categorize changes
  const changes = {
    routes:     changedFiles.filter(f => isRouteFile(f)),
    migrations: changedFiles.filter(f => isMigrationFile(f)),
    models:     changedFiles.filter(f => isModelFile(f)),
    events:     changedFiles.filter(f => isEventFile(f)),
    configs:    changedFiles.filter(f => isConfigFile(f)),
  };

  await Promise.all([
    // 1. Routes changed → re-extract + diff API spec
    changes.routes.length > 0 &&
      updateApiSpec(pr.repoId, changes.routes),

    // 2. Migrations → regenerate ERD
    changes.migrations.length > 0 &&
      regenerateErd(pr.repoId, changes.migrations),

    // 3. Any change → flag related docs as potentially stale
    flagRelatedDocs(pr.repoId, changedFiles),

    // 4. LLM check: does this PR change any documented flow?
    checkFlowImpact(pr, changedFiles),
  ]);
}

async function updateApiSpec(repoId: string, changedRouteFiles: string[]) {
  const currentSpec = await getCurrentSpec(repoId);
  const newRoutes   = await extractRoutes(changedRouteFiles);   // tree-sitter
  const updatedSpec = await mergeIntoSpec(currentSpec, newRoutes); // LLM merge

  // Optic: detect breaking changes
  const diff = await opticDiff(currentSpec, updatedSpec);

  if (diff.breakingChanges.length > 0) {
    await createIssue({
      title: `[API Breaking Change] ${repoId} — ${diff.breakingChanges.length} breaking changes`,
      description: formatBreakingChanges(diff),
      priority: "urgent",
      labels: ["api-contract", "breaking-change"],
    });
  }

  await saveNewSpecVersion(repoId, updatedSpec, diff);
}
```

### 4.3 Intelligent Staleness Scoring

Không chỉ mark stale theo thời gian — dùng LLM để judge mức độ stale:

```typescript
async function assessDocStaleness(doc: TechDoc, prDiff: string): Promise<number> {
  const response = await llm.invoke([
    new SystemMessage(`You are a technical documentation reviewer.
    Rate how likely this document is outdated after the code change (0.0 = still accurate, 1.0 = definitely outdated).
    
    Consider:
    - If the PR changes routes documented in this spec → high staleness
    - If the PR adds new services to a sequence flow → medium staleness
    - If the PR only changes internal logic → low staleness
    - If the PR changes DB schema in an ERD doc → high staleness`),
    new HumanMessage(`Doc type: ${doc.docType}\nDoc title: ${doc.title}\nDoc excerpt: ${doc.body.slice(0,500)}\n\nPR diff summary:\n${prDiff.slice(0,1000)}`),
  ]);

  return parseFloat(extractScore(response.content)); // 0.0 - 1.0
}
```

### 4.4 Auto-Regeneration vs Human Review

```
staleness_score thresholds:

  0.0 - 0.3  → no action (still fresh)
  0.3 - 0.6  → flag "needs_review" + add to next audit
  0.6 - 0.8  → auto-regenerate doc + human confirms
  0.8 - 1.0  → auto-regenerate + create Paperclip issue for review
               + block related PRs until confirmed (if is_critical)
```

---

## 5. Management Strategy — 5 Vấn Đề Cốt Lõi

### Problem 1: Repository Registry — Quản lý nhiều repos

**Strategy: Single Source of Truth với Auto-Discovery**

```
Registration approaches (3 options):
  A. Manual: User adds repo URLs 1-by-1 in UI
  B. GitHub Org Import: Scan GitHub org → show all repos → user selects which to include
  C. Monorepo: Single repo URL + auto-detect sub-packages (nx, turborepo, lerna)

Recommended flow:
  1. User inputs GitHub org token → system lists all repos
  2. User selects relevant repos (checkbox)
  3. Bootstrap Pipeline runs automatically
  4. Repos registered with type/stack auto-detected

Auto-maintenance:
  • Daily: check if any registered repo was archived/deleted
  • Weekly: re-scan repo stats (file count, test coverage, has_openapi_spec)
  • On PR: update last_commit, check for new dependencies
```

### Problem 2: Dependency Graph — Cross-repo relationships

**Strategy: Code-Inferred + Human-Corrected**

```
Automated detection (80% accuracy):
  • HTTP calls: grep for fetch/axios/requests patterns → extract URLs
  • Events: grep for publish/emit/produce patterns → extract topics
  • DB: check if multiple services use same connection string env var
  • npm/pip: check if service B is imported as package in service A

Human correction layer:
  • Bootstrap Report flags unresolved dependencies
  • UI: Dependency Graph editor — drag to add/remove/annotate edges
  • "Discovered by: auto_scan" vs "Discovered by: human" — trust levels

Critical path marking:
  • Any dependency marked is_critical = true
  • Changes to critical-path services → auto P0 issue + alert
```

> **Cross-repo orchestration layer:** Repository Registry + Dependency Graph chỉ là *mô tả* topology. Lớp *thực thi* atomic deploy across repos (saga pattern, contract evolution, deprecation timeline, rollback in reverse order) được thiết kế trong [[Cross-Repo-Coordination-and-Decision-Hardening]] §1. Khi 1 feature span nhiều repos, orchestrator đọc graph này để compute deploy order topologically.

### Problem 3: Technical Documentation — 18 loại doc

**Strategy: Tiered Documentation với Generation + Human-Edit**

```
Tier 1 — Auto-Generated (agent creates, human reviews):
  • API specs (from routes)
  • ERDs (from DB migrations)
  • Component diagrams (from file structure)
  • Dependency maps (from import analysis)

Tier 2 — Agent-Assisted (agent drafts, human writes):
  • Sequence flows (agent generates Mermaid, human validates)
  • Integration flows (agent drafts, human corrects async details)
  • Data flows (agent infers from models + routes)

Tier 3 — Human-Owned (agent only flags gaps):
  • ADRs (agent suggests template, human decides)
  • RFCs (human-driven, agent reviews for consistency)
  • Runbooks (human writes, agent checks completeness)
  • Onboarding guides (human writes from doc inventory)

Living doc rules:
  • Tier 1: auto-regenerate on relevant code change
  • Tier 2: flag for human review on relevant code change
  • Tier 3: only flag if clearly outdated (6+ months + major refactor)
```

### Problem 4: API Spec Registry — Versioned, breaking-change aware

**Strategy: Contract-First với Backward Compat Enforcement**

```
Workflow:
  1. New feature → TypeSpec (.tsp file) written first
  2. TypeSpec compiles to OpenAPI spec
  3. Optic validates: is this backward compatible with current spec?
  4. If breaking: require migration plan doc before PR can merge
  5. Consumers auto-notified (from known_consumers list)

Versioning:
  • Spec version = semver (major.minor.patch)
  • Breaking change = major bump → requires migration doc
  • New endpoint = minor bump → auto-approved
  • Deprecation = minor bump → auto-notify consumers with timeline

Consumer registry:
  • Bootstrap auto-detects consumers from codebase
  • When spec has breaking change → create issues in consumer repos too
  • "blast radius" view: "If this endpoint changes, 3 repos are affected"
```

### Problem 5: Doc Coverage Audit — Đảm bảo mọi thứ được document

**Strategy: Coverage Score + Mandatory Gates**

```
Coverage Score per repo (0-100):
  = weighted sum of:
    • Has API spec?           (weight: 30)
    • Has sequence flows?     (weight: 20, per main feature)
    • Has ERD?                (weight: 15, if has DB)
    • Has runbook?            (weight: 15)
    • Has component diagram?  (weight: 10)
    • Has ADR for major decisions? (weight: 10)

Coverage gates:
  • Score < 40: "Undocumented" → block deploying to production
  • Score 40-70: "Partial" → warning only
  • Score > 70: "Documented" → green
  • Score > 90: "Well-documented" ⭐

Coverage improves automatically:
  • Every PR that adds a doc → score increases
  • Strategic Loop proposes doc tasks when score drops
  • Sprint cannot close with any repo at "Undocumented" level
```

---

## 6. Kiến trúc Hệ thống Đầy đủ

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    KNOWLEDGE BASE SYSTEM                                 │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                      DATA LAYER                                      ││
│  │  project_repos │ repo_dependencies │ tech_docs │ api_specs           ││
│  │  doc_coverage_gaps │ task_efficiency_reviews │ product_signals       ││
│  │  project_brain │ audit_reports │ llm_cost_log                        ││
│  └──────────────────────────────┬──────────────────────────────────────┘│
│                                 │                                         │
│  ┌──────────────────────────────▼──────────────────────────────────────┐│
│  │                   PIPELINE LAYER                                     ││
│  │                                                                      ││
│  │  Bootstrap Pipeline          Continuous Update Pipeline              ││
│  │  (cold start)                (PR-driven)                             ││
│  │                                                                      ││
│  │  ┌─────────────┐             ┌──────────────────────────────────┐   ││
│  │  │ Discovery   │             │ PR Webhook Handler               │   ││
│  │  │ tree-sitter │             │ → diff analysis                  │   ││
│  │  │ ast-grep    │             │ → staleness scoring (LLM)        │   ││
│  │  └──────┬──────┘             │ → auto-regen (Tier 1)            │   ││
│  │         │                    │ → flag for review (Tier 2/3)     │   ││
│  │  ┌──────▼──────┐             │ → breaking change detection (Optic│  ││
│  │  │ Spec Gen    │             └──────────────────────────────────┘   ││
│  │  │ LLM+OpenAPI │                                                     ││
│  │  └──────┬──────┘             Weekly Audit Pipeline                  ││
│  │         │                    ┌──────────────────────────────────┐   ││
│  │  ┌──────▼──────┐             │ Coverage audit                   │   ││
│  │  │ Flow Gen    │             │ Staleness sweep                  │   ││
│  │  │ LLM+Mermaid │             │ Gap detection                    │   ││
│  │  └──────┬──────┘             │ → feed Strategic Loop            │   ││
│  │         │                    └──────────────────────────────────┘   ││
│  │  ┌──────▼──────┐                                                     ││
│  │  │ Bootstrap   │                                                     ││
│  │  │ Report      │                                                     ││
│  │  └─────────────┘                                                     ││
│  └──────────────────────────────┬──────────────────────────────────────┘│
│                                 │                                         │
│  ┌──────────────────────────────▼──────────────────────────────────────┐│
│  │                  INTELLIGENCE LAYER                                  ││
│  │                                                                      ││
│  │  RAG Index (pgvector + LlamaIndex)                                  ││
│  │  → Agents query: "What does the checkout sequence look like?"       ││
│  │  → Impact Analyzer: "Which docs cover /api/payments?"               ││
│  │  → Gap Finder: "Which features have no sequence diagram?"           ││
│  │                                                                      ││
│  │  Knowledge Graph (PostgreSQL adjacency)                             ││
│  │  → "What calls what" → dependency chain                             ││
│  │  → "What breaks if X changes" → blast radius                       ││
│  └──────────────────────────────┬──────────────────────────────────────┘│
│                                 │                                         │
│  ┌──────────────────────────────▼──────────────────────────────────────┐│
│  │                  CONSUMER LAYER                                      ││
│  │                                                                      ││
│  │  Execution Agents    Strategic Loop    Auditor    Human UI          ││
│  │  (doc context)       (gap awareness)   (coverage) (browse/edit)    ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 7. RAG Index — Agents Truy vấn Knowledge Base

Để agents tìm kiếm docs khi cần, không phải inject tất cả vào context:

```typescript
// LlamaIndex code splitter — chunk docs bằng AST-aware splitting
const codebaseIndex = await VectorStoreIndex.fromDocuments(
  await loadDocuments({
    sources: [
      // Source code (AST-chunked)
      new GitHubLoader({ repos: projectRepos, splitter: "ast" }),
      // Tech docs (markdown-chunked)
      new DatabaseLoader({ table: "tech_docs", format: "markdown" }),
      // API specs (openapi-chunked by endpoint)
      new DatabaseLoader({ table: "api_specs", format: "openapi" }),
    ],
  }),
  { vectorStore: pgVectorStore }  // pgvector — đã có Postgres
);

// Agent queries
const context = await codebaseIndex.query(
  `How does the checkout flow work? What APIs are involved?`
);
// → Returns: relevant sequence diagrams + API spec sections + code snippets
```

---

## 8. Implementation Plan

### Phase 0b — Bootstrap Infrastructure (3-4 ngày)
- [ ] Setup tree-sitter bindings (Node.js/Python)
- [ ] Bootstrap Pipeline: Discovery + Spec Gen nodes
- [ ] Bootstrap Report UI trong Paperclip
- [ ] Seed ATO project: import 3 repos, run bootstrap

### Phase 1b — PR-Driven Updates (2-3 ngày)
- [ ] GitHub webhook handler → `onPrMerged()`
- [ ] Optic integration cho breaking-change detection
- [ ] Staleness scoring (LLM)
- [ ] Auto-regen cho Tier 1 docs

### Phase 2b — Coverage Audit (2 ngày)
- [ ] Coverage score computation per repo
- [ ] Doc coverage dashboard trong ProjectDetail
- [ ] Weekly audit cron
- [ ] Coverage gates (warn nếu < 40)

### Phase 3b — RAG Index (2-3 ngày)
- [ ] pgvector extension + schema
- [ ] LlamaIndex pipeline: code + tech_docs + api_specs
- [ ] Agent context builder dùng RAG thay vì inject toàn bộ
- [ ] Query API: `GET /projects/:id/knowledge/query?q=...`

### Phase 4b — Knowledge Graph UI (3-4 ngày)
- [ ] Dependency Graph visualizer (React + D3/Cytoscape)
- [ ] Impact Analyzer UI: input issue → show blast radius
- [ ] Doc browser: filter by type, repo, feature, staleness
- [ ] API Spec viewer với version diff (Optic UI)

---

## 9. Liên kết

- [[Autonomous-PM-Strategic-Loop-Design]] — Strategic Loop dùng KB này
- [[Magika-Integration-and-Codebase-Triage]] — file-type triage feeds RAG splitter
- [[ADR-0002-Pure-LangGraph]]
