---
title: Autonomous Operations & Human Gate Design
tags: [architecture, ci-cd, monitoring, security, approval-center, automation, human-gate]
created: 2026-04-29
status: design
related: "[[Autonomous-PM-Strategic-Loop-Design]], [[Development-Flow-and-Release-Strategy]]"
---

# Autonomous Operations & Human Gate Design

> Thiết kế phần còn thiếu để đạt trạng thái: **toàn bộ hệ thống tự vận hành, human chỉ là gate duy nhất** — một queue tập trung, ưu tiên rõ ràng, risk-scored, với timeout và delegation.

---

## 1. Target State

```
HIỆN TẠI (sau 3 design docs trước):          TARGET STATE:
─────────────────────────────────────         ──────────────────────────────────
Human bị ping từ 10+ nguồn khác nhau         Human có 1 Approval Center duy nhất
Không có CI/CD                                CI/CD tự động hoàn toàn
Không có monitoring → incident               Incident tự phát hiện → tự tạo issue
Không có security scanning                   Security scan trong mọi PR
Agent routing mù theo tên                    Routing theo capability + skill match
DB migration manual/risky                    Migration validated + safe rollback
Timeout → system stall                       Timeout → auto-escalate → safe default
```

---

## 2. Unified Approval Center

> **POLICY OVERLAY:** Mọi gate item trong Approval Center phải tuân thủ [[Autonomy-Dial-and-Progressive-Trust-Design]]:
> - Gate routing dùng confidence-driven (§5 of Autonomy doc) — agent emit confidence, threshold theo workspace autonomy level.
> - Mỗi gate phải có **proposal pattern** attached (Confirm / Choose / Edit / Decide). Default phải là Confirm hoặc Choose; Decide chỉ dùng khi không thể auto-propose.
> - Capability không lifelong gate — sau N successful gates → auto-promote thành non-gate (progressive trust §4 of Autonomy doc).
> - Gate quota per workspace per week (§7); breach trigger auditor review.
> - Notification batching matrix (§8) thay interrupt-driven default.

> **Quan trọng nhất.** Tất cả human gates phải đi qua đây — một queue, một UI, risk-scored, prioritized.

### 2.1 Approval Item Schema

```sql
CREATE TABLE approval_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id),

  -- What needs approval
  approval_type   TEXT NOT NULL,
  -- ── Strategic ────────────────────────────────────────────
  -- 'sprint_plan'          — Strategic Loop: weekly proposals
  -- 'design_doc'           — new design/RFC needs approval
  -- 'design_conflict'      — conflict between designs
  -- 'new_tech_adoption'    — using new library/technology
  -- ── Code & Release ──────────────────────────────────────
  -- 'pr_review'            — PR needs human review (high-risk only)
  -- 'release_decision'     — selective go-live decision
  -- 'breaking_api_change'  — API breaking change detected
  -- 'db_migration'         — database migration approval
  -- ── Operations ──────────────────────────────────────────
  -- 'canary_advance'       — advance canary past 50% (optional gate)
  -- 'budget_warning'       — LLM cost approaching limit
  -- 'rollback_decision'    — should we rollback?
  -- ── Quality ─────────────────────────────────────────────
  -- 'efficiency_fix'       — efficiency improvement action
  -- 'bootstrap_report'     — initial KB review
  -- 'auditor_critical'     — critical audit finding

  title           TEXT NOT NULL,
  summary         TEXT NOT NULL,       -- 2-3 câu TL;DR cho human
  detail_url      TEXT,                -- link to full context

  -- Risk assessment (auto-computed)
  risk_score      INT NOT NULL,        -- 0-100
  risk_level      TEXT NOT NULL,       -- 'critical' | 'high' | 'medium' | 'low'
  risk_factors    JSONB DEFAULT '[]',
  -- [{ factor: "affects_production", weight: 40 },
  --  { factor: "db_migration", weight: 30 },
  --  { factor: "breaking_api_change", weight: 20 }]

  -- Priority (determines queue position)
  priority        INT NOT NULL,        -- 1 (urgent) to 5 (low)

  -- Options presented to human
  options         JSONB NOT NULL,
  -- [{ id: "approve", label: "Approve", description: "...", is_default: false },
  --  { id: "reject",  label: "Reject",  description: "...", is_default: false },
  --  { id: "defer",   label: "Defer 3 days", is_default: true }]

  -- Timeout policy
  timeout_hours   INT,                 -- null = no timeout
  timeout_action  TEXT,                -- 'auto_approve' | 'auto_reject' | 'escalate' | 'pause'
  timeout_at      TIMESTAMPTZ,

  -- Delegation
  can_delegate    BOOLEAN DEFAULT true,
  delegated_to    TEXT,                -- user ID or role
  delegated_at    TIMESTAMPTZ,

  -- State
  status          TEXT DEFAULT 'pending',
  -- 'pending' | 'viewed' | 'decided' | 'timed_out' | 'delegated' | 'auto_resolved'

  decided_option  TEXT,
  decided_by      TEXT,                -- 'human' | 'timeout' | 'auto' | 'delegate'
  decided_at      TIMESTAMPTZ,
  decision_note   TEXT,

  -- Source reference
  source_type     TEXT,                -- 'strategic_loop' | 'auditor' | 'ci_pipeline' | ...
  source_id       TEXT,                -- ID trong hệ thống nguồn

  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_approvals_pending   ON approval_items(project_id, status, priority, risk_score DESC);
CREATE INDEX idx_approvals_timeout   ON approval_items(timeout_at) WHERE status = 'pending';
```

### 2.2 Risk Scoring Engine

```typescript
function computeRiskScore(approvalType: string, context: ApprovalContext): RiskResult {
  const factors: RiskFactor[] = [];
  let score = 0;

  // Base score by type
  const BASE_SCORES: Record<string, number> = {
    'db_migration':        50,   // always high base risk
    'breaking_api_change': 45,
    'release_decision':    40,
    'design_conflict':     35,
    'sprint_plan':         20,
    'pr_review':           15,
    'efficiency_fix':      10,
    'budget_warning':      15,
    'bootstrap_report':    5,
  };
  score += BASE_SCORES[approvalType] ?? 10;

  // Modifiers
  if (context.affectsProduction)        { score += 30; factors.push({ factor: 'affects_production',    weight: 30 }); }
  if (context.isBreakingChange)         { score += 20; factors.push({ factor: 'breaking_change',        weight: 20 }); }
  if (context.affectedUsersCount > 100) { score += 15; factors.push({ factor: 'large_user_impact',     weight: 15 }); }
  if (context.hasSecurityImplication)   { score += 25; factors.push({ factor: 'security_implication',  weight: 25 }); }
  if (context.irreversible)             { score += 20; factors.push({ factor: 'irreversible',           weight: 20 }); }
  if (context.revenueImpact)            { score += 15; factors.push({ factor: 'revenue_impact',        weight: 15 }); }
  if (context.multipleReposAffected)    { score += 10; factors.push({ factor: 'multi_repo',            weight: 10 }); }

  score = Math.min(100, score);

  return {
    score,
    level: score >= 70 ? 'critical' : score >= 50 ? 'high' : score >= 30 ? 'medium' : 'low',
    factors,
  };
}
```

### 2.3 Approval Center UI

```
┌──────────────────────────────────────────────────────────────────────┐
│  APPROVAL CENTER — ATO Project                    4 pending          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  🔴 CRITICAL (risk: 82)                          expires in 4h       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ DB Migration — Add payments.currency_code column (NOT NULL)    │  │
│  │ Affects: payment-service production | 45k rows | irreversible  │  │
│  │ Agent pre-validated: backfill script ready, rollback tested    │  │
│  │ [Review Migration]  [Approve ▼]  [Reject]  [Defer 24h]       │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  🟠 HIGH (risk: 55)                              expires in 12h      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Breaking API Change — POST /payments removes 'currency' field  │  │
│  │ Affects: frontend (1 consumer) | migration guide ready         │  │
│  │ [View Diff]  [Approve with migration]  [Reject]               │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  🟡 MEDIUM (risk: 28)                            no expiry           │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Sprint Plan — 3 proposals for Week 19                          │  │
│  │ Top: "Agent Observability Dashboard" (12 tickets, HIGH churn)  │  │
│  │ [Review Full Plan]  [Approve All]  [Edit & Approve]  [Reject] │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  🟢 LOW (risk: 8)                                auto-approves in 2d │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Efficiency Fix — Route S-complexity tasks to Haiku model       │  │
│  │ Estimated saving: $0.80/sprint | effort: S | no user impact    │  │
│  │ [Approve]  [Reject]  [Auto-approve default in 2 days]         │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  [Approve All Low-Risk]  [Settings]  [Delegation Rules]              │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.4 Timeout & Delegation Policy

```typescript
const TIMEOUT_POLICIES: Record<string, TimeoutPolicy> = {
  // Không thể auto-approve — quá nguy hiểm
  'db_migration':        { hours: 48, action: 'escalate',    escalateTo: 'cto_agent' },
  'breaking_api_change': { hours: 24, action: 'pause',       pauseDescription: 'Block deployment until approved' },
  'release_decision':    { hours: 24, action: 'escalate',    escalateTo: 'senior_human' },

  // Có thể auto-approve sau thời gian
  'sprint_plan':         { hours: 36, action: 'auto_approve', condition: 'all_low_risk_proposals' },
  'efficiency_fix':      { hours: 48, action: 'auto_approve', condition: 'always' },
  'budget_warning':      { hours: 12, action: 'auto_reject',  description: 'Pause spending until reviewed' },

  // Có thể auto-resolve
  'bootstrap_report':    { hours: 72, action: 'auto_approve', condition: 'confidence_score > 0.8' },
  'canary_advance':      { hours: 4,  action: 'auto_approve', condition: 'metrics_healthy' },
};

// Cron: mỗi 15 phút kiểm tra timeouts
async function processApprovalTimeouts() {
  const timedOut = await db.select().from(approvalItems)
    .where(and(
      eq(approvalItems.status, 'pending'),
      lte(approvalItems.timeoutAt, new Date()),
    ));

  for (const item of timedOut) {
    const policy = TIMEOUT_POLICIES[item.approvalType];
    await executeTimeoutAction(item, policy);
  }
}
```

### 2.5 Batch Approve (giảm cognitive load)

```typescript
// Human có thể approve nhiều items cùng lúc nếu cùng risk level
async function batchApprove(projectId: string, maxRiskScore: number = 30) {
  const lowRiskItems = await db.select().from(approvalItems)
    .where(and(
      eq(approvalItems.projectId, projectId),
      eq(approvalItems.status, 'pending'),
      lte(approvalItems.riskScore, maxRiskScore),
    ));

  // Auto-select default option for each
  for (const item of lowRiskItems) {
    const defaultOption = item.options.find(o => o.is_default) ?? item.options[0];
    await resolveApproval(item.id, defaultOption.id, 'human_batch');
  }

  return { approved: lowRiskItems.length };
}
```

---

## 3. CI/CD Pipeline

> Agent merge code → tự động build → test → deploy staging → (gate) → deploy production.

### 3.1 Pipeline Architecture

```
PR Created
    │
    ▼
[Pre-merge CI]                           ~5-10 phút
    ├── lint + type check
    ├── unit tests
    ├── build (Docker image)
    ├── security scan (deps + SAST + secrets)
    └── API contract check (Optic)
    │
    ▼  (all pass → auto-merge nếu low-risk, else approval_item created)
    │
[Post-merge CD — Staging]                ~10-15 phút
    ├── build production image
    ├── run DB migrations (staging)
    ├── deploy to staging environment
    ├── run integration tests
    ├── run E2E smoke tests
    └── update Knowledge Base (PR webhook)
    │
    ▼  (staging healthy → create release candidate)
    │
[Production Gate]                        ← HUMAN GATE (Approval Center)
    │   risk_score based on:
    │   • is DB migration? (+50)
    │   • breaking change? (+45)
    │   • after-hours? (+10)
    │   • first deploy of feature? (+15)
    │
    ▼  (approved → canary or direct)
    │
[Production Deployment]
    ├── canary: 5% → metric gates → 25% → 50% → 100%
    └── direct: immediate 100% (for hotfixes)
```

### 3.2 Pipeline Schema

```sql
CREATE TABLE pipeline_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id),
  repo_id         UUID NOT NULL REFERENCES project_repos(id),

  trigger         TEXT NOT NULL,    -- 'pr_merge' | 'schedule' | 'manual' | 'hotfix' | 'train_promote'
  -- 2026-04-29: branch model refactored to trunk + tag-driven, see [[Git-Branch-Tag-Release-Train-Strategy]]
  source_ref      TEXT NOT NULL,    -- branch name OR tag (e.g. 'main', 'release/2.3.x', 'v2.4.0')
  train_tag       TEXT,             -- when trigger='train_promote': 'trains/2026.04.W17.r3'
  commit_sha      TEXT NOT NULL,
  pr_number       INT,

  -- Stages
  stages          JSONB DEFAULT '[]',
  -- [{ name: "lint", status: "passed", duration_s: 12, logs_url: "..." },
  --  { name: "tests", status: "passed", coverage: 87.3, duration_s: 45 },
  --  { name: "security", status: "passed", vulnerabilities: 0 },
  --  { name: "build", status: "passed", image: "ghcr.io/org/service:abc123" }]

  overall_status  TEXT,             -- 'running' | 'passed' | 'failed' | 'blocked'
  environment     TEXT,             -- 'staging' | 'production'

  -- Gate info
  gate_required   BOOLEAN DEFAULT false,
  approval_item_id UUID REFERENCES approval_items(id),

  started_at      TIMESTAMPTZ DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  duration_s      INT
);
```

### 3.3 Test Strategy — 4 Layers

> **Cập nhật:** Doc gốc define 3 layer (Unit / Integration / E2E). Sau khi thêm [[Testing-and-Quality-Assessment-Capability]] (16-dimension matrix), thêm Layer 4 **Quality** = visual + a11y + UX heuristic + cross-browser/device + i18n + manual TC fallback. PR Gate (Tier 1/Tier 2) + Train build pipeline được define chi tiết tại Testing doc §15.

```typescript
// Layer 1: Unit Tests (agent viết khi implement)
const UNIT_TEST_GATE = {
  minCoverage: 70,
  mustCoverNewFiles: true,
  failOnRegression: true,
};

// Layer 2: Integration Tests (auto-generated từ API specs)
async function generateIntegrationTests(apiSpec: OpenApiSpec) {
  return await llm.invoke([
    new SystemMessage(`Generate integration test cases for each endpoint.
    Cover: happy path, validation errors, auth failures, edge cases.`),
    new HumanMessage(JSON.stringify(apiSpec)),
  ]);
}

// Layer 3: E2E Smoke Tests — Hercules NL scenarios per feature_key
// Linked to feature_flags — only run when flag is enabled
const E2E_SMOKE_TESTS = {
  'enable_bulk_export': ['test_bulk_export_small', 'test_bulk_export_large', 'test_export_cancel'],
  'enable_dark_mode':   ['test_dark_mode_toggle', 'test_dark_mode_persist'],
};

// Layer 4: Quality Tests — added per Testing doc
// - Visual regression (Playwright snapshot + diff)
// - a11y (axe-core WCAG 2.1 AA)
// - Cross-browser (Chromium + Firefox + WebKit + BrowserStack)
// - Cross-device viewport matrix
// - Mobile native (Appium iOS Sim + Android Emu)
// - i18n locale matrix (en/vi/ja/de/ar + qps-ploc pseudo-locale)
// - UX heuristic (LLM-as-Judge Nielsen 10, multimodal screenshots)
// - Property-based / fuzz (Hypothesis + schemathesis)
// - Persona-driven scenarios (chị Lan, ...) reusing Greenfield personas
// - Production synthetic probe (Hercules cron 5-min trên prod)
// - Manual TC fallback cho phần tool gap (xem Testing §17)
const QUALITY_GATE = {
  visual_diff_threshold: 0.1,    // % pixel diff
  a11y_violations_max: 0,        // serious + critical
  ux_heuristic_min_score: 7,     // /10 từ LLM-as-Judge
  manual_tc_blocking: true,       // manual TC chưa pass → block Train promotion
};
```

→ Test Case Browser (Quality tab in Approval Center) hiển thị toàn bộ 4-layer status per feature_key, cross-link với pipeline_runs + release_trains.

---

## 4. Monitoring → Incident Automation

> Production break → tự phát hiện → tự tạo issue → tự assign agent.

### 4.1 Metrics Collection

```sql
CREATE TABLE service_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id         UUID NOT NULL REFERENCES project_repos(id),
  project_id      UUID NOT NULL REFERENCES projects(id),

  metric_type     TEXT NOT NULL,
  -- 'error_rate'     — % requests returning 5xx
  -- 'p99_latency'    — 99th percentile latency ms
  -- 'p50_latency'    — median latency ms
  -- 'throughput'     — requests/second
  -- 'memory_usage'   — MB
  -- 'cpu_usage'      — %
  -- 'queue_depth'    — async job queue size
  -- 'db_pool_usage'  — DB connection pool %

  value           FLOAT NOT NULL,
  environment     TEXT DEFAULT 'production',
  recorded_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE alert_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id),
  repo_id         UUID REFERENCES project_repos(id),  -- null = applies to all

  metric_type     TEXT NOT NULL,
  condition       TEXT NOT NULL,    -- 'gt' | 'lt' | 'change_pct'
  threshold       FLOAT NOT NULL,
  window_minutes  INT DEFAULT 5,    -- evaluate over last N minutes

  severity        TEXT NOT NULL,    -- 'critical' | 'high' | 'medium'
  auto_create_issue BOOLEAN DEFAULT true,
  auto_assign_dept  TEXT,           -- 'devops' | 'engineering'

  -- Cooldown — không spam issues
  cooldown_minutes INT DEFAULT 60,
  last_triggered_at TIMESTAMPTZ
);
```

### 4.2 Incident → Issue Flow

```typescript
// Evaluator chạy mỗi 1 phút
async function evaluateAlertRules() {
  const rules = await getActiveAlertRules();

  for (const rule of rules) {
    const metric = await getAggregatedMetric(rule, rule.windowMinutes);
    const triggered = evaluateCondition(metric, rule);

    if (!triggered) continue;

    // Cooldown check
    if (rule.lastTriggeredAt && minutesSince(rule.lastTriggeredAt) < rule.cooldownMinutes) continue;

    // Create incident issue
    const issue = await createIssue({
      title: `[INCIDENT] ${rule.repoName}: ${rule.metricType} ${rule.condition} ${rule.threshold}`,
      description: await generateIncidentDescription(rule, metric),
      priority: rule.severity === 'critical' ? 'urgent' : 'high',
      labels: ['incident', 'monitoring', rule.metricType],
      // Auto-assign to on-call agent
      assigneeAgentId: await getOnCallAgent(rule.autAssignDept),
    });

    // High-risk incident → Approval Center
    if (rule.severity === 'critical') {
      await createApprovalItem({
        approvalType: 'rollback_decision',
        title: `Critical incident: should we rollback? (${rule.repoName})`,
        summary: `${rule.metricType} is ${metric.value} (threshold: ${rule.threshold}). Rollback available.`,
        riskScore: 85,
        options: [
          { id: 'rollback', label: 'Rollback now', description: 'Revert to last stable release' },
          { id: 'wait',     label: 'Let agent investigate first', is_default: true },
          { id: 'hotfix',   label: 'Create hotfix branch' },
        ],
        timeoutHours: 1,
        timeoutAction: 'escalate',
      });
    }

    await updateAlertRule(rule.id, { lastTriggeredAt: new Date() });
  }
}
```

### 4.3 SLO Tracking

```sql
CREATE TABLE slo_definitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id     UUID NOT NULL REFERENCES project_repos(id),

  name        TEXT NOT NULL,          -- "Payment API availability"
  metric_type TEXT NOT NULL,          -- "error_rate"
  target_pct  FLOAT NOT NULL,         -- 99.9 (= 99.9% availability)
  window_days INT DEFAULT 30,

  -- Current status (updated hourly)
  current_pct   FLOAT,
  error_budget_remaining_pct FLOAT,   -- how much budget left before SLO breach
  status        TEXT                  -- 'healthy' | 'at_risk' | 'breached'
);
```

---

## 5. Security Scanning Pipeline

> Mọi PR đều qua security scan tự động — không cần human security review thủ công.

### 5.1 Three-Layer Security

```
Layer 1: Pre-commit (agent side)
  └── Secret detection: API keys, passwords, tokens in code
      Tool: truffleHog / detect-secrets (CLI, self-hosted)
      Action: Block commit if secret found

Layer 2: PR CI gate
  ├── Dependency vulnerabilities: npm audit / pip audit / Snyk OSS
  │   Action: Block merge if CRITICAL vuln; warn for HIGH
  ├── SAST (static analysis): ESLint security rules / Bandit (Python)
  │   Action: Block merge if HIGH+ finding
  └── License compliance: check new deps don't introduce GPL into proprietary code
      Action: Warn only

Layer 3: Weekly full scan (background)
  ├── Full dependency tree scan (all repos)
  ├── Container image scan (Trivy)
  └── Infrastructure-as-code scan (checkov)
      → auto-create issues for findings
```

### 5.2 Security Issue Auto-Creation

```typescript
async function processSecurityScanResults(scanResult: ScanResult) {
  for (const finding of scanResult.findings) {
    if (finding.severity === 'critical' || finding.severity === 'high') {
      // Auto-create issue
      await createIssue({
        title: `[SECURITY] ${finding.type}: ${finding.packageName ?? finding.file}`,
        description: formatSecurityFinding(finding),
        priority: finding.severity === 'critical' ? 'urgent' : 'high',
        labels: ['security', finding.severity, finding.type],
        assigneeAgentId: await getSecurityAgent(),
      });

      // Critical security → Approval Center immediately
      if (finding.severity === 'critical') {
        await createApprovalItem({
          approvalType: 'pr_review',
          title: `Critical security finding requires human review`,
          summary: finding.description,
          riskScore: 90,
          options: [
            { id: 'fix_first', label: 'Block deployment until fixed', is_default: true },
            { id: 'accept_risk', label: 'Accept risk and continue' },
          ],
          timeoutHours: 4,
          timeoutAction: 'auto_reject',  // safe default: block
        });
      }
    }
  }
}
```

---

## 6. Database Migration Safety Net

> DB migrations là thao tác high-risk nhất — cần validation và rollback plan trước khi human approves.

### 6.1 Migration Lifecycle

```
Agent writes migration file
    │
    ▼
[Auto Validation]
    ├── Syntax check (can it run?)
    ├── Dry-run on staging DB snapshot
    ├── Estimate: row count affected, lock duration
    ├── Check: is column NOT NULL without default? (dangerous)
    ├── Check: is table drop? (irreversible flag)
    ├── Generate rollback migration automatically
    └── Estimate downtime (if any)
    │
    ▼
[Approval Item Created]
    risk_score = 50 (base)
      + 30 if NOT NULL without default
      + 20 if affects table > 100k rows
      + 40 if DROP TABLE/COLUMN
      + 0  if additive only (new table, new nullable column)
    │
    ▼  (human approves)
    │
[Staged Execution]
    ├── Run on staging first
    ├── Verify staging healthy (5 min soak)
    ├── Run on production (with timeout)
    └── Verify production healthy (10 min soak)
    │
    ▼  (if anything fails → auto-rollback)
    │
[Auto-rollback Trigger]
    └── Run rollback migration
        → Notify human via Approval Center
        → Create incident issue
```

### 6.2 Migration Schema

```sql
CREATE TABLE migration_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id),
  repo_id         UUID NOT NULL REFERENCES project_repos(id),

  migration_file  TEXT NOT NULL,
  migration_sql   TEXT NOT NULL,
  rollback_sql    TEXT,              -- auto-generated

  -- Analysis
  affected_tables   JSONB DEFAULT '[]',
  estimated_rows    INT,
  estimated_lock_ms INT,
  is_reversible     BOOLEAN DEFAULT true,
  is_additive_only  BOOLEAN DEFAULT false,  -- true = safe, no approval needed
  risk_factors      JSONB DEFAULT '[]',

  -- Execution tracking
  staging_run_at  TIMESTAMPTZ,
  staging_status  TEXT,
  prod_run_at     TIMESTAMPTZ,
  prod_status     TEXT,

  approval_item_id UUID REFERENCES approval_items(id),
  status          TEXT DEFAULT 'pending_validation'
);
```

---

## 7. Agent Capability Registry

> Agent routing hiện tại mù. Cần biết agent nào giỏi cái gì để assign đúng.

### 7.1 Capability Schema

```sql
CREATE TABLE agent_capabilities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents(id),

  -- Skills (từ performance history)
  skills      JSONB DEFAULT '[]',
  -- [{ skill: "typescript", proficiency: 0.9, task_count: 47, avg_quality: 85 },
  --  { skill: "python",     proficiency: 0.7, task_count: 23, avg_quality: 72 },
  --  { skill: "database",   proficiency: 0.8, task_count: 15, avg_quality: 88 }]

  -- Specializations
  best_task_types   JSONB DEFAULT '[]',  -- ["backend_feature", "api_design", "bug_fix"]
  worst_task_types  JSONB DEFAULT '[]',  -- ["frontend_styling", "data_migration"]

  -- Capacity
  current_load    INT DEFAULT 0,         -- active tasks
  max_concurrent  INT DEFAULT 3,

  updated_at    TIMESTAMPTZ DEFAULT now()
);
```

### 7.2 Smart Routing

```typescript
async function findBestAgent(task: Issue, companyId: string): Promise<Agent> {
  const requiredSkills = await inferRequiredSkills(task); // LLM infers from title/desc

  const candidates = await db.select({
    agent: agents,
    caps: agentCapabilities,
  })
  .from(agents)
  .leftJoin(agentCapabilities, eq(agentCapabilities.agentId, agents.id))
  .where(and(
    eq(agents.companyId, companyId),
    eq(agents.status, 'active'),
    // Not at capacity
    sql`${agentCapabilities.currentLoad} < ${agentCapabilities.maxConcurrent}`,
  ));

  // Score each candidate
  const scored = candidates.map(c => ({
    agent: c.agent,
    score: computeAgentScore(c.caps, requiredSkills, task),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0].agent;
}

function computeAgentScore(caps: AgentCapabilities, required: string[], task: Issue): number {
  let score = 0;

  // Skill match
  for (const skill of required) {
    const agentSkill = caps.skills.find(s => s.skill === skill);
    score += agentSkill ? agentSkill.proficiency * 40 : 0;
  }

  // Task type match
  if (caps.bestTaskTypes.includes(task.type)) score += 20;
  if (caps.worstTaskTypes.includes(task.type)) score -= 20;

  // Availability (lower load = higher score)
  score += (1 - caps.currentLoad / caps.maxConcurrent) * 20;

  // Historical quality for this task type
  const histQuality = caps.skills.find(s => required.includes(s.skill))?.avgQuality ?? 70;
  score += (histQuality / 100) * 20;

  return score;
}
```

### 7.3 Capability Auto-Learning

```typescript
// Sau mỗi task done — cập nhật capability
async function updateAgentCapabilities(issueId: string, agentId: string) {
  const review   = await getEfficiencyReview(issueId);
  const taskSkills = await inferRequiredSkills(issue);

  for (const skill of taskSkills) {
    await upsertSkill(agentId, skill, {
      proficiency:  computeNewProficiency(existingSkill, review.qualityDepthScore),
      taskCount:    existingSkill.taskCount + 1,
      avgQuality:   rollingAvg(existingSkill.avgQuality, review.qualityDepthScore, 10),
    });
  }
}
```

---

## 8. Complete Human Gate Map

> Tổng hợp tất cả gates — ai triggers, risk score nào, timeout policy.

| Gate | Triggered by | Risk | Timeout | Timeout action |
|------|-------------|------|---------|---------------|
| Sprint plan approval | Strategic Loop (weekly) | 20-35 | 36h | auto_approve if all low-risk |
| Design doc approval | New design created | 30-50 | 48h | pause |
| Design conflict resolution | Conflict Detector | 40-70 | 24h | escalate |
| New tech adoption | Design with new tech | 35-55 | 48h | pause |
| PR review (high-risk only) | CI pipeline | 40-60 | 24h | auto_approve if metrics ok |
| Breaking API change | Optic diff | 55-75 | 24h | pause |
| DB migration | Migration Validator | 50-90 | 48h | escalate |
| Release decision | Release Manager | 40-70 | 24h | pause |
| Canary >50% | Canary Controller | 30-50 | 4h | auto_approve if metrics ok |
| Critical incident rollback | Monitoring | 80-95 | 1h | escalate |
| Budget warning | Cost Guard | 15-30 | 12h | auto_reject (pause spend) |
| Security critical finding | Security Scanner | 85-100 | 4h | auto_reject (block deploy) |
| Auditor critical alert | Auditor | 60-80 | 24h | escalate |
| Efficiency fix (high) | Efficiency Reviewer | 10-25 | 48h | auto_approve |
| Bootstrap report | KB Bootstrap | 5-20 | 72h | auto_approve if confidence >0.8 |

**Human weekly time budget (estimate):**
```
Gate reviews per week:           ~8-12 items
Average time per item:           2-5 minutes
Total human time/week:           ~20-40 minutes
```

---

## 9. Notification Routing

> Human nhận đúng thứ cần quan tâm, không bị noise.

```typescript
const NOTIFICATION_RULES = {
  // Channels: 'approval_center' | 'inbox' | 'email' | 'slack' | 'push'
  channels: [
    // Critical: tất cả channels
    { condition: 'risk_score >= 80',   channels: ['approval_center', 'slack', 'push'], priority: 1 },
    // High: approval center + slack
    { condition: 'risk_score >= 50',   channels: ['approval_center', 'slack'], priority: 2 },
    // Medium: approval center only
    { condition: 'risk_score >= 30',   channels: ['approval_center'], priority: 3 },
    // Low: batch into daily digest
    { condition: 'risk_score < 30',    channels: ['daily_digest'], priority: 5 },
  ],

  // Quiet hours: no push/slack during off-hours (except critical)
  quietHours: { start: '22:00', end: '08:00', timezone: 'Asia/Ho_Chi_Minh' },
  quietException: 'risk_score >= 80',  // critical bypasses quiet hours

  // Daily digest: collect all low-risk items and send summary at 9am
  dailyDigest: { time: '09:00', includeMaxRisk: 30 },
};
```

---

## 10. Implementation Roadmap

### Phase 0d — Approval Center (3-4 ngày) ← Làm trước nhất
- [ ] `approval_items` table + API
- [ ] Approval Center UI (queue, risk badges, options)
- [ ] Risk scoring engine
- [ ] Timeout processor (cron mỗi 15 phút)
- [ ] Wire all existing `interrupt()` calls → Approval Center
- [ ] Batch approve (low-risk bulk action)

### Phase 1d — CI/CD Pipeline (4-5 ngày)
- [ ] `pipeline_runs` table
- [ ] Pre-merge CI: lint + tests + security + Optic
- [ ] Post-merge CD: staging deploy automation
- [ ] Production gate wired to Approval Center
- [ ] Canary controller auto-advance

### Phase 2d — Monitoring & Incidents (3-4 ngày)
- [ ] `service_metrics` + `alert_rules` tables
- [ ] Metrics ingestion (from existing services)
- [ ] Alert evaluator (cron 1 min)
- [ ] Incident → issue auto-creation
- [ ] SLO tracking dashboard

### Phase 3d — Security Pipeline (2-3 ngày)
- [ ] Integrate `npm audit` / `pip audit` in CI
- [ ] Secret scanning (truffleHog) pre-commit hook
- [ ] Security finding → issue auto-creation
- [ ] Critical security → Approval Center gate

### Phase 4d — DB Migration Safety (2-3 ngày)
- [ ] `migration_reviews` table
- [ ] Migration validator (dry-run on staging snapshot)
- [ ] Rollback SQL auto-generator
- [ ] Staged execution with soak periods

### Phase 5d — Agent Capabilities (2 ngày)
- [ ] `agent_capabilities` table
- [ ] Smart routing algorithm
- [ ] Auto-learning from Efficiency Reviews
- [ ] Capability dashboard

---

## 11. Liên kết

- [[Autonomous-PM-Strategic-Loop-Design]] — Strategic Loop, Auditor, Efficiency Reviewer
- [[Development-Flow-and-Release-Strategy]] — Design lifecycle, branch strategy, feature flags
- [[Knowledge-Base-Management-Strategy]] — Repo registry, tech docs, bootstrap
