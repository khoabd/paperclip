---
tags: [architecture, foundation, platform, workspace, mission, model]
date: 2026-04-29
type: foundational-model
related:
  - 00-Master-Architecture-Overview
  - Full-System-Workflow-and-Coordination
  - Autonomous-PM-Strategic-Loop-Design
  - Knowledge-Base-Management-Strategy
  - Decision-Boundary-and-Uncertainty-Model
---

# Paperclip — Platform / Workspace / Mission Model

> **Đây là foundational doc.** Define cách Paperclip handle N projects song song với agent/skill/tool **shared** ở platform-level và project context **isolated** ở workspace-level. Đọc doc này TRƯỚC mọi doc khác về tenant/multi-tenant — vì các doc đó nói về sản phẩm Paperclip BUILD ra, không phải Paperclip core.

## 1. 3-layer architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       PLATFORM LAYER (shared)                        │
│                  Owner: anh khoabui (single tenant)                  │
│                                                                      │
│  Agent Pool ── Skill Library ── Tool Registry ── Capability Registry │
│  Cross-project Learning Store ── Global Cost Cap ── Scheduler        │
│                                                                      │
│  → singleton, không bị fork theo project                             │
└─────────────────────────────────────────────────────────────────────┘
                ▲                                       ▲
                │ borrow agent / skill / tool           │
                │                                       │
┌───────────────┼───────────────┐       ┌───────────────┼───────────────┐
│        WORKSPACE A             │  ...  │        WORKSPACE Z             │
│  (isolation boundary)          │       │                                │
│                                │       │                                │
│  brain ── repo ── DB schema    │       │  brain ── repo ── DB schema    │
│  RAG ns ── logs ns ── budget   │       │  RAG ns ── logs ns ── budget   │
│  secrets path ── audit chain   │       │  secrets path ── audit chain   │
│  mission queue ── decision log │       │  mission queue ── decision log │
└──────┬─────────────────────────┘       └──────┬─────────────────────────┘
       │                                         │
       │ creates                                 │ creates
       ▼                                         ▼
┌──────────────────────┐                 ┌──────────────────────┐
│   MISSION (ephemeral) │                 │   MISSION (ephemeral) │
│  workspace_id = A     │                 │  workspace_id = Z     │
│  agent = Engineer#42  │                 │  agent = Architect#8  │
│  tools = [git, mcp]   │                 │  tools = [git, rag]   │
│  cost → workspace A   │                 │  cost → workspace Z   │
└──────────────────────┘                 └──────────────────────┘
```

**Analogy:** Platform = công ty consulting (có nhân sự, kỹ năng, tool); Workspace = mỗi client/dự án (context, code, history riêng); Mission = task cụ thể giao cho 1 nhân sự với context của 1 client.

---

## 2. Platform Layer — Shared, Singleton

### 2.1 Agent Pool

**Định nghĩa:** Tập agent class shared — singleton ở platform level. Khi workspace cần action → "borrow" agent từ pool, run, return.

| Agent | Vai trò | Số instance |
|---|---|---|
| ArchitectAgent | Design schema, API contract, ADR | 1 class, N concurrent calls |
| EngineerAgent | Implement task, write code | 1 class, N |
| ProductManagerAgent | Strategic Loop, sprint plan | 1 class, N |
| DesignerAgent | UI/UX design, design system | 1 class, N |
| QAAgent | Test gen, Hercules, manual TC | 1 class, N |
| DevOpsAgent | CI/CD, deploy, canary, rollback | 1 class, N |
| SupportAgent | Customer ticket triage | 1 class, N |
| SecurityAgent | Scan, threat model | 1 class, N |
| AuditorAgent | Internal audit, drift | 1 class, N |

→ "1 nhân sự, N dự án" = 1 class, N concurrent missions (mỗi mission có context riêng).

### 2.2 Skill Library

**Định nghĩa:** Prompt templates, chain templates, playbooks — shared as code/prompt artifacts.

```
skills/
  architect/
    design_rest_api.prompt.md
    decide_storage_engine.prompt.md
    write_adr.prompt.md
  engineer/
    implement_endpoint.prompt.md
    refactor_extract_method.prompt.md
    write_unit_test.prompt.md
  pm/
    weekly_strategic_review.prompt.md
    persona_synthesis.prompt.md
  ...
```

- Versioned (semver per skill).
- Update 1 skill → propagate platform-wide với canary mode (xem §11).
- Skill calls cite source (skill_id + version) → audit traceable.

### 2.3 Tool Registry

Đã có code (`ToolRegistry`). Tool implementations shared:
- GitTool, OpenSearchTool, MCPClient (GitLab/OpenSearch/Tavily/arXiv)
- HerculesTool (Playwright wrapper), AppiumTool, AxeCoreTool
- MagikaTool, RAGTool, BudgetTool, AuditTool
- ...

Per-workspace có thể restrict tool access (xem §10).

### 2.4 Capability Registry

```sql
CREATE TABLE agent_capabilities (
  capability_id TEXT PRIMARY KEY,
  agent_role TEXT NOT NULL,          -- 'engineer', 'architect', ...
  description TEXT,
  risk_level TEXT,                   -- 'low' / 'medium' / 'high' / 'critical'
  default_mode TEXT,                 -- 'auto' / 'gate' / 'disabled'
  required_tools TEXT[],
  version INT NOT NULL,
  introduced_at TIMESTAMPTZ DEFAULT now(),
  deprecated_at TIMESTAMPTZ
);
```

**Ví dụ rows:**
| capability_id | agent_role | risk | default_mode |
|---|---|---|---|
| `engineer.write_code` | engineer | low | auto |
| `engineer.commit_to_main` | engineer | medium | gate |
| `engineer.delete_file` | engineer | high | gate |
| `devops.deploy_live` | devops | critical | gate |
| `devops.rollback_canary` | devops | medium | auto |
| `qa.run_hercules_prod` | qa | medium | auto |
| `pm.approve_feature_kickoff` | pm | high | gate |

→ Workspace override (§10) có thể downgrade auto → gate, nhưng không upgrade gate → auto (security floor).

### 2.5 Cross-Project Learning Store

Tách 2 cấp:

| Type | Storage | Áp dụng |
|---|---|---|
| **Project-local lesson** | `workspace.lessons` | Chỉ workspace đó |
| **Global principle** | `platform.principles` (versioned) | Tất cả workspace |

Promotion rule (project-local → global):
```python
def should_promote_to_global(lesson):
    return (
        lesson.observed_count_across_workspaces >= 3
        and lesson.distinct_workspaces >= 2
        and lesson.severity in {'high', 'critical'}
        and not lesson.context_dependent  # determined by classifier
    )
```

Khi promote → injects vào prompt template của agent role tương ứng (next call dùng).

### 2.6 Global Cost Cap

```yaml
platform_cost_cap:
  daily_usd: 200
  monthly_usd: 5000
  per_workspace_default_daily: 30
  per_workspace_default_monthly: 600
```

Vượt → freeze workspace có spend cao nhất, alert anh. Xem [[Autonomous-PM-Strategic-Loop-Design]] §11 cost guard.

### 2.7 Scheduler

Khi 10 workspaces cùng request LLM call:
- LLM quota limited (rate limit của Anthropic) → fair-share queueing.
- Per-workspace priority slot (vd workspace có hot incident được boost).
- Detail §9.

### 2.8 Skill runtime contract — Gap B

Skill = pure function với contract:

```python
@skill(skill_id="architect.design_rest_api", version="2.3.1", capability_id="architect.design_api")
class DesignRestApi:
    input_schema  = RestApiBrief         # Pydantic
    output_schema = OpenApiDraft         # Pydantic
    cost_p50_usd  = 0.12
    cost_p90_usd  = 0.30
    status        = "stable"             # 'canary' | 'stable' | 'deprecated'

    async def run(self, brief: RestApiBrief) -> OpenApiDraft: ...
```

Registry table:
```sql
CREATE TABLE skill_registry (
  skill_id        TEXT,
  version         TEXT,                  -- semver
  code_path       TEXT,
  input_schema    JSONB,
  output_schema   JSONB,
  capability_id   TEXT REFERENCES agent_capabilities(capability_id),
  status          TEXT,                  -- canary/stable/deprecated
  cost_p50_usd    NUMERIC,
  cost_p90_usd    NUMERIC,
  brier_30d       NUMERIC,               -- per-skill calibration
  rejection_rate_7d NUMERIC,
  introduced_at   TIMESTAMPTZ,
  promoted_at     TIMESTAMPTZ,
  deprecated_at   TIMESTAMPTZ,
  PRIMARY KEY (skill_id, version)
);
```

Invocation runtime:
```python
async def invoke_skill(workspace, skill_id, version_constraint, inputs):
    # 1. Resolve version
    candidates = registry.find(skill_id, version_constraint)
    if workspace.accept_canary_skills:
        version = pick_latest(candidates, allow=['canary', 'stable'])
    else:
        version = pick_latest(candidates, allow=['stable'])

    # 2. Validate input
    skill = load(skill_id, version)
    skill.input_schema.validate(inputs)   # raises early on schema fail

    # 3. Execute → validate output → fallback if invalid
    try:
        result = await skill.run(inputs)
        skill.output_schema.validate(result)
    except (OutputSchemaError, RuntimeError):
        prev_stable = registry.previous_stable(skill_id, version)
        result = await load(skill_id, prev_stable).run(inputs)
        emit('skill_fallback', {skill_id, from: version, to: prev_stable})

    # 4. Emit telemetry (cost + latency + outcome)
    emit('skill_invocation', {skill_id, version, cost, tokens, ms, success})
    return result
```

Canary promotion / demotion:
- Canary published → only workspaces with `accept_canary_skills=true` (default sandbox + high autonomy) get it.
- ≥100 successful invocations & rejection_rate_7d < 5% → auto-promote to stable.
- After promotion: per-skill Brier > 0.15 OR rejection_rate_7d > 20% → auto-demote to previous stable + create approval item "skill regression".

---

## 3. Workspace Layer — Isolation per Project

### 3.1 Isolation contract

| Resource | Namespace pattern | Scope |
|---|---|---|
| Filesystem | `/workspace/<workspace_id>/` | Mọi file tạo bởi mission của workspace đó |
| Postgres schema | `pclip_<workspace_id>` | Project brain, missions, decisions, audit |
| RAG (pgvector) | collection `rag_<workspace_id>_*` | Embeddings của codebase + docs project đó |
| Logs (OpenSearch) | label `workspace_id=<id>` | Mọi log emit từ mission của workspace |
| Cache (Redis) | key prefix `ws:<workspace_id>:` | Cache scoped |
| Secrets (Vault) | path `workspaces/<workspace_id>/*` | API key, DB password project đó |
| Audit log | `audit_log` row có `workspace_id` FK + Merkle chain per workspace | Tamper-evident per workspace |
| Brain snapshots | `brain_snapshots` table có `workspace_id` FK | Decision-time consistency |
| Mission queue | `missions` table có `workspace_id` | Pending tasks |

### 3.2 Schema

```sql
CREATE TABLE workspaces (
  workspace_id TEXT PRIMARY KEY,        -- 'quanlychungcu', 'gymapp'
  display_name TEXT NOT NULL,
  state TEXT NOT NULL,                  -- 'intake' / 'active' / 'paused' / 'frozen' / 'archived' / 'retired'
  created_at TIMESTAMPTZ DEFAULT now(),
  archived_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  product_kind TEXT,                    -- 'b2b_saas' / 'b2c' / 'internal_tool'
  brain_snapshot_id UUID,               -- latest snapshot
  filesystem_path TEXT NOT NULL,
  pg_schema TEXT NOT NULL,
  rag_collection_prefix TEXT NOT NULL,
  vault_path TEXT NOT NULL,
  budget_cap_daily_usd NUMERIC(10,2),
  budget_cap_monthly_usd NUMERIC(10,2),
  llm_quota_priority INT DEFAULT 5,     -- 1=highest, 10=lowest
  metadata JSONB
);

CREATE TABLE workspace_capability_overrides (
  workspace_id TEXT REFERENCES workspaces,
  capability_id TEXT REFERENCES agent_capabilities,
  mode TEXT NOT NULL,                   -- 'auto' / 'gate' / 'disabled'
  reason TEXT,
  set_by UUID,
  set_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (workspace_id, capability_id),
  CHECK (mode IN ('auto','gate','disabled'))
);

CREATE TABLE workspace_lifecycle_events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces,
  event_type TEXT,                      -- 'created' / 'paused' / 'resumed' / 'frozen' / 'archived' / 'retired'
  triggered_by TEXT,                    -- 'human' / 'auto' / 'cost_cap' / 'inactivity'
  details JSONB,
  occurred_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.3 Workspace ≠ Tenant

| Workspace | Tenant (theo doc Multi-Tenant đã viết) |
|---|---|
| Project bên TRONG Paperclip | End-customer của sản phẩm Paperclip BUILD ra |
| Anh decide | App quản lý chung cư decide |
| 1 workspace = "QuanLyChungCu app" | 1 tenant = "BQT Ngọc Xuân" trong app đó |
| Isolation: file/DB/RAG/logs ở Paperclip layer | Isolation: T1 RLS / T2 schema / T3 DB ở app cuối |

→ Hai khái niệm hoàn toàn khác layer. Nhầm sẽ thiết kế sai.

---

## 4. Mission Layer — Per-Task Binding

### 4.1 Mission là gì

Mission = đơn vị công việc nhỏ nhất chạy bởi agent. 1 mission có:
- `mission_id` (UUID)
- `workspace_id` (FK) — context binding
- `goal` (Goal object — từ code hiện tại)
- `assigned_role` (architect / engineer / ...)
- `state` (queued / running / awaiting_approval / done / failed)
- `parent_mission_id` (cho sub-mission)
- `cost_so_far_usd`
- `started_at`, `completed_at`

### 4.2 Mission flow

```
Workspace.create_mission(goal, role) ──► Mission queue
                                              │
                                              ▼
                          Scheduler picks mission (per-workspace fair-share)
                                              │
                                              ▼
                          Platform.agent_pool.borrow(role) ──► Agent instance handle
                                              │
                                              ▼
                          Agent.run(mission_context):
                            - Load workspace.brain_snapshot
                            - Load workspace.repo state
                            - Apply workspace.capability_overrides
                            - Use platform.skill_library
                            - Call platform.tool_registry (with workspace-scoped perms)
                                              │
                                              ▼
                          Result → mission.complete()
                            - Cost attributed to workspace_id
                            - Audit emit (workspace.audit + global audit)
                            - Decision logged
                                              │
                                              ▼
                          Agent released back to pool (no state retained)
```

### 4.3 Reentrancy contract

Agent class **MUST**:
- Không có instance state outside method scope.
- Không cache by global key (cache theo `mission_id`).
- Mọi tool call pass `MissionContext` để tool biết scope (filesystem path, log namespace, secret path).
- LLM provider call attribute cost via `MissionContext.cost_attribution_id = workspace_id`.

Test guard: agent unit tests phải verify chạy 100 mission concurrent với 100 workspace khác nhau, không cross-contamination.

---

## 5. Concurrency Model

### 5.1 Parallel missions

Cùng 1 thời điểm có thể có:
- 50 missions chạy across 10 workspaces.
- 5 missions cùng type "EngineerAgent.implement_task" cho 5 workspace khác nhau.
- 2 missions cho cùng workspace (vd 2 task song song trong cùng project, không conflict file).

### 5.2 Conflict detection (intra-workspace)

Trong cùng workspace có thể có conflict (vd 2 mission cùng edit file). Conflict-detection-engine ở [[Development-Flow-and-Release-Strategy]] §3 handle:
- Mission acquire "file lock" optimistic per file path.
- Conflict → 1 mission delay, 1 proceed.

### 5.3 Cross-workspace

Không có conflict natively (isolated). Chỉ có resource contention (LLM quota, compute) — xử lý ở §9.

### 5.4 Async handle

Mỗi mission run trong async task. PostgresSaver checkpoint per mission → restart-safe. Watchdog (Self-Healing) per mission_id.

---

## 6. Cross-Project Knowledge Sharing

### 6.1 Knowledge classification

Khi 1 lesson được học (vd rejection learning, audit finding, efficiency review):

| Classifier output | Action |
|---|---|
| **project-specific** | Lưu vào `workspace.lessons`, chỉ áp dụng workspace đó |
| **universal** | Promote thành `platform.principles`, áp dụng all workspaces |
| **conditional** | Lưu vào `platform.conditional_principles` với `if_condition` (vd "áp dụng khi product_kind=b2b_saas") |

### 6.2 Promotion criteria

```python
def classify_lesson(lesson, history):
    # signal: lesson observed in multiple workspaces?
    cross_count = count_workspaces_observing_similar(lesson)
    
    # signal: context-dependent?
    is_context_dependent = bool(lesson.references_specific_codebase)
    
    # signal: severity
    severity = lesson.severity
    
    if cross_count >= 3 and not is_context_dependent and severity >= 'high':
        return 'universal'
    if is_context_dependent or cross_count == 1:
        return 'project-specific'
    return 'conditional'
```

### 6.3 Global principle injection

Khi promote → next call của agent role tương ứng inject principle vào prompt:
```
SYSTEM PROMPT for EngineerAgent:
{base_prompt}

[GLOBAL PRINCIPLES — auto-applied across all workspaces]
- {principle_1}
- {principle_2}
...

[WORKSPACE-SPECIFIC LESSONS]
- {lesson_1_for_this_workspace}
...
```

### 6.4 Demotion / sunset

Principle không hữu ích sau X lần áp dụng → reviewer auto-flag, demote về conditional hoặc remove. Avoid "principle bloat".

### 6.5 Conflict resolution

Project-local lesson và global principle conflict → project-local thắng (workspace context closer to problem). Nhưng emit warning lên Auditor để review.

---

## 7. Cost Attribution

### 7.1 Rule

Mỗi LLM call, tool call, compute usage:
```python
cost_event = {
    'mission_id': ...,
    'workspace_id': mission.workspace_id,    # primary attribution
    'agent_role': mission.assigned_role,     # secondary, for analytics
    'usd': ...,
    'tokens': {...},
    'model': ...,
    'occurred_at': ...
}
```

→ Roll up: `SUM(usd) GROUP BY workspace_id` → workspace bill.

Agent role thấy được "tôi đang dùng bao nhiêu cost trên platform" cho analytics (vd EngineerAgent costs > QAAgent on average), nhưng billing attribute workspace.

### 7.2 Caps

- **Per-workspace daily cap**: vượt → freeze workspace, alert.
- **Per-workspace monthly cap**: hard limit theo project budget (Greenfield đã set khi intake).
- **Global daily cap** (platform): vượt → freeze workspace có spend cao nhất.
- **Per-mission cap**: 1 mission không được spend > $X trong 1 lần (default $5; "high-risk" mission > $1 require gate).

### 7.3 Anomaly detection

Cost anomaly detector cron 5-min:
- Workspace X spend bình thường $1/h, đột nhiên $20/h → emit alert.
- Detection trigger Self-Healing Rule 4 (cost runaway) → kill mission có cost cao nhất nếu xác định runaway loop.

---

## 8. Workspace Lifecycle

### 8.1 States

```
   intake ──► active ──► paused ──► active (resume)
                │            │
                ▼            ▼
              frozen      archived ──► retired (final)
                │
                ▼
              active (unfreeze)
```

| State | Meaning | Trigger |
|---|---|---|
| `intake` | Greenfield đang chạy 7-stage pipeline | Wizard submit |
| `active` | Bình thường, chạy missions | Greenfield complete |
| `paused` | Tạm dừng theo lệnh, missions queued không pick up | Manual / cost cap breach soft |
| `frozen` | Đóng băng do inactivity > 30d hoặc cost cap breach hard | Auto / manual |
| `archived` | Read-only, brain còn nhưng không tạo mission mới | Manual ("dự án xong") |
| `retired` | Hoàn toàn xóa data theo retention | After archived 1y + manual confirm |

### 8.2 Transitions runbook

| From → To | Effect |
|---|---|
| intake → active | Brain finalized, repo scaffolded, sprint 1 ready |
| active → paused | Cancel pending missions, snapshot brain, no LLM calls |
| paused → active | Re-enqueue missions, resume Strategic Loop |
| active → frozen | Auto khi inactive 30d hoặc cost breach; tear down active connections, keep storage |
| frozen → active | Manual unfreeze, warm-up cron (rebuild RAG cache, ...) |
| active → archived | Manual; missions cancelled, brain frozen, repo readonly |
| archived → retired | Manual, after 1y; storage purge per retention policy |

### 8.3 Auto-freeze

```python
def auto_freeze_check():
    for workspace in active_workspaces:
        if days_since_last_mission(workspace) > 30:
            freeze(workspace, reason='inactivity')
        elif workspace.cost_breach_consecutive_days >= 3:
            freeze(workspace, reason='cost_cap_persistent_breach')
```

---

## 9. Cross-Workspace Scheduler

### 9.1 Concern

10 workspaces cùng tạo mission → LLM quota có hạn (vd Anthropic concurrent slot 50). Cần fair-share.

### 9.2 Algorithm — weighted fair queueing

```python
def pick_next_mission():
    """
    Each workspace has llm_quota_priority (1=highest, 10=lowest).
    Compute share: 1 / priority. Workspace với priority cao chiếm slot nhiều hơn.
    """
    candidates = []
    for ws in active_workspaces:
        if ws.queued_missions:
            share = 1.0 / ws.llm_quota_priority
            consumed = ws.llm_calls_in_window(last=300)  # last 5 min
            need = share - consumed * normalization
            candidates.append((ws, need))
    
    # pick workspace với need cao nhất
    candidates.sort(key=lambda x: -x[1])
    return candidates[0][0].next_mission()
```

### 9.3 Priority boost

Tự động boost (priority -= 2 temporary) khi:
- Workspace có hot incident (incident_state='active').
- Workspace có Train trong promotion gate (train.state='ready_to_promote').
- Human explicit boost via UI.

### 9.4 Quota types

| Resource | Quota mechanism |
|---|---|
| LLM calls | WFQ above |
| GPU/embedding | Token bucket per workspace |
| Disk IO | OS-level cgroup per workspace path |
| MCP rate (GitLab/OpenSearch) | Shared MCP client respects per-server limit, queue per workspace |

### 9.5 Cross-workspace conflict UX — Gap C

Khi WFQ preempt 1 mission để nhường slot cho workspace khác:

```sql
CREATE TABLE quota_preemption_events (
  id                 UUID PRIMARY KEY,
  from_workspace_id  TEXT,
  to_workspace_id    TEXT,
  mission_id         TEXT,
  reason             TEXT,             -- 'priority_boost' | 'fair_share_rebalance'
  duration_lost_min  NUMERIC,
  occurred_at        TIMESTAMPTZ DEFAULT now()
);
```

**Override:** workspace có thể set `pin_quota=true` → WFQ skip preemption với workspace đó (cost: skip pin nếu global LLM rate limit hit ngưỡng cứng, log warn).

**Notification level:**
- Mission < 10 min lost → silent log (chỉ thấy ở digest).
- Mission > 30 min lost → critical interrupt → approval item "Mission preempted; resume now / wait?".

**UI:** xem [[UX-Strategy-and-Design]] §7.3 "Cross-workspace activity panel".

---

## 10. Per-Workspace Capability Override

### 10.1 Use case

- Workspace healthcare-app: disable agent capability `engineer.call_external_http_arbitrary` (compliance constraint).
- Workspace financial-app: gate `devops.deploy_live` even though default auto.
- Workspace experimental: allow `engineer.commit_to_main` direct (default gate).

### 10.2 Rule

`workspace_capability_overrides` table (§3.2). Mode lookup chain:
1. Workspace override (if exists) → use.
2. Global default (`agent_capabilities.default_mode`).

### 10.3 Security floor

Một số capabilities **KHÔNG** được override xuống "auto" dù workspace yêu cầu:
- `devops.deploy_live` (always require gate or human approve)
- `engineer.delete_data_destructive` (always gate)
- `security.exempt_scan` (always disabled, no override)
- DSR-related ops (always audited)

→ Floor enforced at platform code layer, không qua DB rule (defense in depth).

### 10.4 Apply autonomy template — Sync #7

Khi tạo workspace mới hoặc admin bulk-update, gọi `apply_template(workspace_id, template_name)`:

```python
TEMPLATES = {
    'sandbox': {
        'autonomy_level': 'sandbox',
        'weekly_cost_cap_usd': 50,
        'gate_quota_per_week': 12,
        'accept_canary_skills': True,
        'capability_overrides': {
            'engineer.commit_to_main': 'auto',     # default 'gate' downgraded
            'engineer.delete_file':    'auto',
        },
    },
    'startup-experimental': {
        'autonomy_level': 'high',
        'weekly_cost_cap_usd': 200,
        'gate_quota_per_week': 8,
        'accept_canary_skills': True,
        'capability_overrides': {},                 # use defaults
    },
    'default': {
        'autonomy_level': 'medium',
        'weekly_cost_cap_usd': 150,
        'gate_quota_per_week': 5,
        'accept_canary_skills': False,
        'capability_overrides': {},
    },
    'regulated-fintech': {
        'autonomy_level': 'low',
        'weekly_cost_cap_usd': 300,
        'gate_quota_per_week': 3,
        'accept_canary_skills': False,
        'capability_overrides': {
            'devops.rollback_canary': 'gate',       # default 'auto' upgraded → gate
            'qa.run_hercules_prod':   'gate',
            'engineer.write_code':    'gate',       # all code reviewed
        },
    },
}

def apply_template(workspace_id, template_name):
    t = TEMPLATES[template_name]
    workspace.autonomy_profile = t                  # JSONB
    for cap, mode in t['capability_overrides'].items():
        # Security floor enforcement (§10.3)
        if cap in SECURITY_FLOOR_CAPS and mode == 'auto':
            raise ValueError(f'{cap} cannot be auto (security floor)')
        upsert_override(workspace_id, cap, mode)
    emit('autonomy_template_applied', workspace_id, template_name)
```

→ Reapply template sau khi update central definition để re-baseline workspace.

---

## 11. Skill / Agent Versioning

### 11.1 Versioning scheme

Mỗi skill có semver: `architect.design_rest_api@2.3.1`.

```sql
CREATE TABLE skill_versions (
  skill_id TEXT,
  version TEXT,                      -- semver
  prompt_md TEXT NOT NULL,
  changelog TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  status TEXT,                       -- 'canary' / 'stable' / 'deprecated'
  PRIMARY KEY (skill_id, version)
);

CREATE TABLE skill_workspace_pins (
  workspace_id TEXT REFERENCES workspaces,
  skill_id TEXT,
  pinned_version TEXT,               -- nếu workspace muốn pin specific
  PRIMARY KEY (workspace_id, skill_id)
);
```

### 11.2 Update rollout

```
Skill update committed (new version 2.4.0)
    │
    ▼
Status = 'canary' (chỉ apply 1 workspace volunteer)
    │
    ▼ (24h soak + outcome metrics)
    │
   pass → Status = 'stable' (apply all unpinned)
   fail → Status = 'deprecated' (revert)
```

### 11.3 Outcome metrics

- Mission completion rate post-update vs pre-update (must not regress > 5%).
- Cost per mission post-update (must not regress > 10%).
- Rejection rate post-update (must not increase > 5%).
- Auditor finding rate.

### 11.4 Pinning

Workspace có thể pin skill version (vd compliance audit cần stable behavior). Ngăn auto-update.

---

## 12. Approval Center Cross-Workspace UX

### 12.1 Default view

```
┌────────────────────────────────────────────────────────────┐
│  APPROVAL CENTER                  [All workspaces ▼]        │
├────────────────────────────────────────────────────────────┤
│  ⚠️  HOT (3)                                                │
│   [QuanLyChungCu] Train 2026.04.W17.r3 → env/live    Promote│
│   [GymApp]        Migration approve (alter column)   Approve│
│   [CRM-X]         Hotfix INC-892 → live              Approve│
├────────────────────────────────────────────────────────────┤
│  📋 NORMAL (12)                                             │
│   [QuanLyChungCu] PR #234 visual diff                      │
│   [GymApp]        Manual TC #88 result review              │
│   ...                                                       │
├────────────────────────────────────────────────────────────┤
│  Filters: workspace × type × risk × age                     │
└────────────────────────────────────────────────────────────┘
```

### 12.2 Filter & sort

- Filter: workspace, item type, risk, age.
- Sort: risk × age × cost-impact (ranking algo).
- Batch approve: only items có risk=low + age<2h + same workspace.

### 12.3 Per-workspace view

Drill into 1 workspace → giống single-project Approval Center hiện tại.

### 12.4 Notification routing

- Default: anh nhận tất cả workspace.
- Per-workspace mute (vd workspace archived chỉ cần weekly digest, không real-time).

---

## 13. Strategic Loop Scoping

### 13.1 Per-workspace Loop

Mỗi workspace có Strategic Loop riêng — weekly cron Mon 08:00, scope:
- Signals: chỉ workspace's customer signals + workspace's KB.
- Plan: chỉ workspace's sprint.
- Brain: workspace's brain.

### 13.2 Global digest

Bên cạnh per-workspace, có **1 global digest cron** weekly Fri:
- Aggregate: total cost, total feature shipped, total incidents.
- Cross-workspace insight: workspace nào ngốn nhiều, project nào hot, project nào idle.
- Send to anh: 1 email Friday tổng kết all projects.

### 13.3 Internal Auditor

- Per-workspace Auditor weekly (đã có design).
- Global Auditor monthly: cross-project drift, principle effectiveness, cost trend.

---

## 14. Refactor Implication for Current `Company` Class

### 14.1 Hiện tại (code đã có)

```python
class Company:
    self._depts: dict[str, Department]      # OWN departments
    self._budget: Budget                     # OWN budget
    self._mission_store: MissionStore        # OWN missions
    self._tool_registry: ToolRegistry | None # injected (already shareable)
    self.product_id: str = "default"         # 1 product per Company
```

### 14.2 Theo model mới — 2 hướng refactor

**Option A — Đổi semantics, giữ tên `Company`:**
- `Company` rename internally → "WorkspaceRunner" hoặc giữ tên nhưng documented as "workspace-bound runner".
- `_depts` không own — replaced bằng `dept_pool: AgentPool` injected từ platform.
- `_budget` thành workspace-scoped budget tracker; platform có aggregate budget tracker tách rời.
- `product_id` rename `workspace_id`.

**Option B — Add layer mới, giữ Company nguyên:**
- Tạo `Platform` class wrap `AgentPool` + `SkillLibrary` + `ToolRegistry`.
- Tạo `Workspace` class wrap state (filesystem, DB schema, RAG, ...).
- `Company` thành "binding": `Company(platform, workspace)` — uses platform for agents, workspace for state.

→ Khuyến nghị: **Option B** ít breaking change. `Company` giữ vai trò "runtime binder", semantic vẫn match (1 company = 1 effort/team building 1 product).

### 14.3 Migration sketch

```python
# NEW
platform = Platform(
    agent_pool=AgentPool([ArchitectAgent, EngineerAgent, ...]),
    skill_library=SkillLibrary.load_from_repo(),
    tool_registry=ToolRegistry(...),
    capability_registry=CapabilityRegistry(...),
)

workspace = Workspace.load("quanlychungcu")

company = Company(
    name="QuanLyChungCu",
    platform=platform,
    workspace=workspace,
)

mission = company.create_mission(goal=..., role='engineer')
await company.run_mission(mission)
```

CLI `Company(name="HelloCo")` legacy → nội bộ tạo default Platform + Workspace để giữ test/dev DX.

### 14.4 Backward compat

- Test cũ có `Company(name="HelloCo")` → vẫn chạy được nhờ default Platform + ephemeral Workspace.
- New tests use 3-layer explicit.

---

## 15. Schema Consolidated

| Table | Layer | Source |
|---|---|---|
| `workspaces` | Workspace | §3.2 |
| `workspace_capability_overrides` | Workspace | §3.2 |
| `workspace_lifecycle_events` | Workspace | §3.2 |
| `agent_capabilities` | Platform | §2.4 |
| `skill_versions` | Platform | §11.1 |
| `skill_workspace_pins` | Platform | §11.1 |
| `platform_principles` | Platform | §6.1 |
| `platform_conditional_principles` | Platform | §6.1 |
| `missions` | Mission | (existing, add `workspace_id` FK) |
| `mission_cost_events` | Mission | §7.1 |
| `cost_anomalies` | Platform | §7.3 |
| `llm_quota_state` | Platform | §9 |

### 15.1 Cost attribution table

```sql
CREATE TABLE mission_cost_events (
  id BIGSERIAL PRIMARY KEY,
  mission_id UUID NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces,
  agent_role TEXT,
  event_kind TEXT,                   -- 'llm_call' / 'tool_call' / 'compute' / 'storage'
  usd NUMERIC(10,4),
  tokens_input INT, tokens_output INT,
  model TEXT,
  occurred_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON mission_cost_events (workspace_id, occurred_at DESC);
CREATE INDEX ON mission_cost_events (mission_id);
```

### 15.2 Aggregate views

```sql
CREATE MATERIALIZED VIEW workspace_daily_cost AS
SELECT workspace_id,
       date_trunc('day', occurred_at) AS day,
       SUM(usd) AS usd_total,
       SUM(tokens_input + tokens_output) AS tokens_total
FROM mission_cost_events
GROUP BY workspace_id, day;

REFRESH MATERIALIZED VIEW CONCURRENTLY workspace_daily_cost;  -- cron 5m
```

---

## 16. North star

| Metric | Target |
|---|---|
| Concurrent workspaces supported | ≥ 30 active without degradation |
| Cross-workspace LLM fairness (gini coefficient) | < 0.3 |
| Skill update canary→stable success rate | > 80% |
| Global principle promotion accuracy (still useful at 30d) | > 70% |
| Cross-workspace cost variance | per-workspace within ±50% baseline unless flagged |
| Workspace freeze recovery time | < 5 min from unfreeze command |
| Agent reentrancy bugs (cross-mission contamination) | 0 (hard requirement, test-gated) |

---

## 17. Liên kết

Foundational:
- [[00-Master-Architecture-Overview]] — Layer model overview
- [[Full-System-Workflow-and-Coordination]] — Trigger inventory + master wiring
- [[Decision-Boundary-and-Uncertainty-Model]] — Brain snapshot + decision routing
- [[Knowledge-Base-Management-Strategy]] — Per-workspace KB + cross-workspace shared store

Adjacent:
- [[Autonomous-PM-Strategic-Loop-Design]] — Per-workspace Loop + global digest
- [[Autonomous-Operations-and-Human-Gate-Design]] — Approval Center cross-workspace
- [[Self-Healing-and-Liveness-Design]] — Watchdog per mission + global cost runaway
- [[Greenfield-Bootstrap-Design]] — Workspace creation (intake state)
- [[Rejection-Learning-and-Feedback-Loop]] — Local lesson vs global principle

---

## 18. Implementation roadmap

| Sprint | Effort | Deliverable |
|---|---|---|
| Sprint 1 | 5d | Workspace schema + lifecycle state machine + basic isolation (filesystem + pg schema + RAG ns + log ns) |
| Sprint 2 | 4d | AgentPool + Platform class + refactor Company to bind Platform+Workspace (Option B §14) |
| Sprint 3 | 3d | Capability registry + workspace overrides + security floor enforcement |
| Sprint 4 | 4d | Cross-workspace scheduler (WFQ) + LLM quota state + priority boost |
| Sprint 5 | 3d | Cost attribution table + per-workspace daily/monthly cap + anomaly detector |
| Sprint 6 | 3d | Skill library file structure + skill_versions table + canary rollout for skills |
| Sprint 7 | 4d | Cross-project learning store + lesson classifier + global principle injection |
| Sprint 8 | 3d | Approval Center cross-workspace view + filters + batch approve |
| Sprint 9 | 2d | Global Strategic Loop digest cron + per-workspace Loop scoping |
| Sprint 10 | 3d | Workspace lifecycle runbook (pause/freeze/archive/retire) + auto-freeze cron |
| Sprint 11 | 2d | Reentrancy test suite (100 concurrent missions, 100 workspaces, no contamination) |

Total: ~36 ngày eng work.

---

## 19. Score impact

Trước doc này, "multi-project parallelism" implicit, không có spec rõ. Khi anh chạy 5+ projects → architecture sẽ break ở:
- Cost attribution (không biết project nào ngốn).
- Knowledge bleed (lesson project A áp dụng nhầm cho project B).
- Resource contention (project nào chiếm hết LLM quota).
- Capability creep (vô tình bật capability nguy hiểm cho project compliance).

Sau doc này:
| Khía cạnh | Trước | Sau |
|---|---|---|
| Concurrent project support | Implicit, không test | Explicit, target 30 active |
| Cross-project cost transparency | 0 | 9/10 (per-mission attribution) |
| Cross-project learning safety | Random apply | 9/10 (classifier + promotion rule) |
| Capability per-workspace control | Không có | 9/10 (override + security floor) |
| Reentrancy correctness | Implicit | 9/10 (test-gated) |

Cộng vào aggregate Paperclip overall: 9.0 → **9.2/10**.

---

## 20. Open questions

1. **`Company` rename?** — Option A vs Option B (§14). Đề xuất B, nhưng implement có thể đổi.
2. **Workspace clone/fork** — vd duplicate "QuanLyChungCu" thành "QuanLyChungCu-experiment" để thử feature lớn — chưa design chi tiết, nếu cần sẽ thêm §21.
3. **Workspace federation** — multi-region workspace hosting (vd anh có ops ở SG + EU) — chưa cần ở phase đầu.
4. **Agent specialization per workspace** — vd EngineerAgent fine-tuned riêng cho 1 codebase Rust — chưa cần.

→ Để open, không block implementation.
