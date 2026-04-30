---
title: External Integrations & Environment Strategy
tags: [architecture, mcp, gitlab, opensearch, environments, k8s, integrations]
created: 2026-04-29
status: design
related: "[[Autonomous-Operations-and-Human-Gate-Design]], [[Development-Flow-and-Release-Strategy]]"
---

# External Integrations & Environment Strategy

> Paperclip không tự deploy, không tự collect logs. Nó **orchestrate qua GitLab** và **observe qua OpenSearch**. K8s và các external services được quản lý hoàn toàn bên ngoài.

---

## 1. Separation of Concerns — Ai làm gì

```
┌─────────────────────────────────────────────────────────────────────┐
│                      RESPONSIBILITY MAP                              │
│                                                                       │
│  PAPERCLIP (orchestrator)                                            │
│  ├── Task management, agent assignment                               │
│  ├── Knowledge base, project brain                                   │
│  ├── Strategic loop, auditor, approvals                              │
│  ├── Tells GitLab: "create branch", "merge MR", "run pipeline"      │
│  └── Reads from OpenSearch: logs, errors, metrics from logs          │
│                                                                       │
│  GITLAB (source of truth — code & CI/CD)                            │
│  ├── Source code storage (all repos)                                 │
│  ├── Branch management, MRs                                          │
│  ├── CI pipelines (test, build, security scan)                       │
│  └── CD pipelines (deploy to k8s per environment)                   │
│                                                                       │
│  OPENSEARCH (observability)                                          │
│  ├── Application logs (all services, all environments)               │
│  ├── Access logs, error logs, audit logs                             │
│  └── Metrics exported as log events (if using log-based metrics)    │
│                                                                       │
│  KUBERNETES (runtime — externally managed)                           │
│  ├── dev / stag / live clusters                                      │
│  ├── Service deployments, scaling, health                            │
│  └── Managed by external platform team (not by Paperclip)           │
└─────────────────────────────────────────────────────────────────────┘
```

**Paperclip tương tác với external systems qua 2 kênh duy nhất:**
```
Paperclip ──[MCP: GitLab]──▶ GitLab API  ──▶ K8s (Paperclip không biết)
Paperclip ◀──[MCP: OpenSearch]── OpenSearch ◀── All services log here
```

---

## 2. MCP Architecture

### 2.1 MCP Server Registration

```typescript
// Trong Paperclip — MCP servers được đăng ký per project
CREATE TABLE mcp_servers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id),
  project_id      UUID REFERENCES projects(id),  -- null = company-wide

  name            TEXT NOT NULL,          -- "gitlab-internal", "opensearch-prod"
  server_type     TEXT NOT NULL,
  -- 'gitlab'         — GitLab instance
  -- 'opensearch'     — OpenSearch/Elasticsearch cluster
  -- 'jira'           — Jira (future)
  -- 'pagerduty'      — PagerDuty (future)
  -- 'custom'         — any MCP-compatible server

  endpoint        TEXT NOT NULL,          -- MCP server URL
  auth_type       TEXT DEFAULT 'token',   -- 'token' | 'oauth' | 'basic'
  auth_config     JSONB,                  -- encrypted credentials config

  -- Scoping
  environments    JSONB DEFAULT '["dev","stag","live"]',  -- which envs this server covers
  readonly        BOOLEAN DEFAULT false,  -- true = only read operations allowed

  -- Health
  last_ping_at    TIMESTAMPTZ,
  status          TEXT DEFAULT 'active',  -- 'active' | 'degraded' | 'offline'

  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### 2.2 MCP Tool Catalog per Server Type

```typescript
// Tools available from GitLab MCP server
const GITLAB_MCP_TOOLS = {
  // Branches
  'gitlab.branch.create':      { desc: 'Create branch from ref' },
  'gitlab.branch.delete':      { desc: 'Delete branch' },
  'gitlab.branch.list':        { desc: 'List branches matching pattern' },

  // Merge Requests
  'gitlab.mr.create':          { desc: 'Create MR with title, description, target' },
  'gitlab.mr.update':          { desc: 'Update MR description, labels, assignee' },
  'gitlab.mr.merge':           { desc: 'Merge an approved MR' },
  'gitlab.mr.close':           { desc: 'Close MR without merging' },
  'gitlab.mr.get':             { desc: 'Get MR status, pipeline, approvals' },
  'gitlab.mr.list':            { desc: 'List MRs by state/author/label' },
  'gitlab.mr.add_comment':     { desc: 'Add review comment to MR' },

  // Pipelines
  'gitlab.pipeline.trigger':   { desc: 'Trigger pipeline on branch/tag' },
  'gitlab.pipeline.get':       { desc: 'Get pipeline status and stage results' },
  'gitlab.pipeline.cancel':    { desc: 'Cancel running pipeline' },
  'gitlab.pipeline.retry':     { desc: 'Retry failed pipeline' },
  'gitlab.pipeline.list':      { desc: 'List pipelines for branch' },

  // Files & Commits
  'gitlab.file.read':          { desc: 'Read file content at ref' },
  'gitlab.file.create':        { desc: 'Create/update file with commit message' },
  'gitlab.commit.list':        { desc: 'List commits on branch since date' },
  'gitlab.diff.get':           { desc: 'Get diff between refs' },

  // Releases & Tags
  'gitlab.tag.create':         { desc: 'Create tag at commit' },
  'gitlab.release.create':     { desc: 'Create release from tag with notes' },
  'gitlab.release.get':        { desc: 'Get release details' },
};

// Tools available from OpenSearch MCP server
const OPENSEARCH_MCP_TOOLS = {
  // Log queries
  'opensearch.logs.search':    { desc: 'Full-text search across log indices' },
  'opensearch.logs.query':     { desc: 'DSL query for structured log fields' },
  'opensearch.logs.tail':      { desc: 'Get latest N log entries for service' },
  'opensearch.logs.count':     { desc: 'Count log entries matching filter' },

  // Error analysis
  'opensearch.errors.top':     { desc: 'Top error messages in time window' },
  'opensearch.errors.trend':   { desc: 'Error count over time (for anomaly detection)' },
  'opensearch.errors.trace':   { desc: 'Full error with stack trace by trace_id' },

  // Performance
  'opensearch.latency.p99':    { desc: 'P99 latency for endpoint in window' },
  'opensearch.latency.hist':   { desc: 'Latency histogram for endpoint' },

  // Audit
  'opensearch.audit.user':     { desc: 'Audit log for user actions' },
  'opensearch.audit.deploy':   { desc: 'Deployment events log' },
};
```

---

## 3. Environment Model — Full Picture

### 3.1 Environment Definitions

"Local" không phải một môi trường đơn — nó có **3 sub-layers** với vai trò khác nhau, trước khi code lên dev:

```
┌──────────────────────────────────────────────────────────────────┐
│ LOCAL-DEVELOPER                                                   │
│ • Docker Compose trên laptop developer/agent runner               │
│ • Paperclip KHÔNG có visibility trực tiếp                        │
│ • Developer/agent tự quản lý, không có URL public                │
│ • Dùng để: viết code, chạy unit test nhanh                       │
└──────────────────────────────────────────────────────────────────┘
         │ agent đẩy code lên, cần test tích hợp
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ EPHEMERAL WORKSPACE (per task/branch)                            │
│ • Docker Compose được Paperclip tự spin up trên shared runner    │
│ • 1 task = 1 workspace riêng, isolated                          │
│ • Paperclip có đầy đủ visibility: logs, health, test results     │
│ • Agent chạy tests, verify feature hoạt động ở đây              │
│ • Tự động destroy sau khi MR created hoặc sau 4h idle            │
│ • Logs ship to OpenSearch (index: logs-ephemeral-{taskId}-*)     │
└──────────────────────────────────────────────────────────────────┘
         │ tests pass → tạo MR → GitLab trigger CI
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ PREVIEW (per MR — GitLab Review Apps)                            │
│ • K8s namespace tự động tạo khi MR opened                       │
│ • URL: preview-{branch}.dev.company.com                         │
│ • QA agent + human QA test manual ở đây                         │
│ • Accessible qua browser — UI/UX review                         │
│ • Paperclip đọc logs qua OpenSearch (index: logs-preview-*)      │
│ • Tự động destroy khi MR merged hoặc closed                     │
└──────────────────────────────────────────────────────────────────┘
         │ QA passed, MR approved → merge to develop
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ DEV (k8s)                                                         │
│ • Auto-deploy khi MR merged vào branch `develop`                 │
│ • GitLab CI/CD tự chạy                                           │
│ • Paperclip đọc logs qua OpenSearch (index: logs-dev-*)          │
│ • Paperclip trigger pipeline qua GitLab MCP                      │
│ • Không cần human approval để deploy                             │
└──────────────────────────────────────────────────────────────────┘
         │ promote (tag or MR to staging branch)
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ STAG (k8s)                                                        │
│ • Deploy khi MR merged vào branch `staging` hoặc tag `stag-*`   │
│ • Paperclip đọc logs qua OpenSearch (index: logs-stag-*)         │
│ • QA agent chạy regression + E2E smoke tests sau deploy          │
│ • Paperclip tạo approval item nếu E2E fails                      │
│ • Cần human approval để promote lên live                         │
└──────────────────────────────────────────────────────────────────┘
         │ human approves → promote
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ LIVE (k8s)                                                        │
│ • Deploy chỉ khi tag `v*.*.*` + GitLab CD pipeline               │
│ • Paperclip đọc logs qua OpenSearch (index: logs-live-*)         │
│ • KHÔNG tự deploy — chỉ trigger GitLab pipeline sau approval     │
│ • Canary managed bởi GitLab CD + feature flags                   │
│ • Mọi deployment phải qua Approval Center                        │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Ephemeral Workspace — Thiết kế chi tiết

```
┌─────────────────────────────────────────────────────────────────┐
│               EPHEMERAL WORKSPACE MANAGER                        │
│            (chạy trên shared runner server)                      │
│                                                                   │
│  Paperclip ──[MCP: runner]──▶ Runner Agent                      │
│                                   │                              │
│                              docker-compose up                   │
│                                   │                              │
│                         ┌─────────┴──────────┐                  │
│                         │ Workspace Instance  │                  │
│                         │ task: ATO-512       │                  │
│                         │ branch: feature/... │                  │
│                         │ port: 13512         │                  │
│                         │ services: api, db,  │                  │
│                         │          redis      │                  │
│                         └─────────┬──────────┘                  │
│                                   │ logs → OpenSearch            │
│                                   │ health → Paperclip           │
└───────────────────────────────────┼─────────────────────────────┘
                                    │
                Agent writes code   │  Agent tests via workspace URL
                     │              ▼
                     └──▶  http://runner:13512 (internal)
```

```sql
CREATE TABLE ephemeral_workspaces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id),
  issue_id        UUID NOT NULL REFERENCES issues(id),
  agent_id        UUID REFERENCES agents(id),

  branch_name     TEXT NOT NULL,
  runner_host     TEXT NOT NULL,          -- shared runner server hostname
  compose_file    TEXT NOT NULL,          -- which docker-compose.yml to use
  port_mapping    JSONB DEFAULT '{}',     -- { "api": 13512, "frontend": 13513 }

  -- Services health
  services        JSONB DEFAULT '[]',
  -- [{ name: "api", status: "healthy", port: 13512 },
  --  { name: "db",  status: "healthy", port: 15432 }]

  -- Logs
  log_index       TEXT,                   -- opensearch index: logs-ephemeral-{id}-*

  -- Lifecycle
  status          TEXT DEFAULT 'provisioning',
  -- 'provisioning' | 'ready' | 'running_tests' | 'idle' | 'destroying' | 'destroyed'

  auto_destroy_at TIMESTAMPTZ,            -- idle timeout: +4h from last activity
  created_at      TIMESTAMPTZ DEFAULT now(),
  destroyed_at    TIMESTAMPTZ
);
```

### 3.3 Ephemeral Workspace Lifecycle

```typescript
// Trigger: khi agent nhận task và bắt đầu implement
async function provisionWorkspace(issue: Issue, agent: Agent): Promise<Workspace> {
  const repo        = await getRepo(issue.projectId);
  const composeFile = await selectComposeFile(repo, 'local');
  // Ưu tiên: docker-compose.local.yml → docker-compose.yml

  // Cấp 1 port block cho task này (tránh conflict)
  const ports = await allocatePorts(issue.id, composeFile);

  // Gọi Runner MCP — spin up docker-compose
  const runner = await getRunnerMcpClient(issue.projectId);
  await runner.call('runner.compose.up', {
    workspaceId: workspace.id,
    repoUrl:     repo.repoUrl,
    branch:      `feature/ATO-${issue.identifier}-${slugify(issue.title)}`,
    composeFile,
    ports,
    env: {
      DATABASE_URL: `postgresql://localhost:${ports.db}/testdb`,
      REDIS_URL:    `redis://localhost:${ports.redis}`,
      NODE_ENV:     'test',
    },
  });

  // Seed test data
  await runner.call('runner.compose.exec', {
    workspaceId: workspace.id,
    service: 'api',
    command: 'npm run db:seed:test',
  });

  return workspace;
}

// Trigger: agent xong, gọi tests trước khi tạo MR
async function runWorkspaceTests(workspaceId: string): Promise<TestResult> {
  const runner = await getRunnerMcpClient();

  // Unit tests
  const unit = await runner.call('runner.compose.exec', {
    workspaceId,
    service: 'api',
    command: 'npm test -- --coverage',
  });

  // Integration tests (hit actual running services)
  const integration = await runner.call('runner.compose.exec', {
    workspaceId,
    service: 'api',
    command: 'npm run test:integration',
  });

  return {
    unitPassed:        unit.exitCode === 0,
    integrationPassed: integration.exitCode === 0,
    coverage:          parseFloat(unit.stdout.match(/Coverage: ([\d.]+)/)?.[1] ?? '0'),
    failedTests:       parseFailures(unit.stderr + integration.stderr),
  };
}

// Destroy sau khi MR created hoặc idle 4h
async function destroyWorkspace(workspaceId: string) {
  const runner = await getRunnerMcpClient();
  await runner.call('runner.compose.down', { workspaceId, removeVolumes: true });
  await db.update(ephemeralWorkspaces)
    .set({ status: 'destroyed', destroyedAt: new Date() })
    .where(eq(ephemeralWorkspaces.id, workspaceId));
}
```

### 3.4 Preview Environment (GitLab Review Apps)

```typescript
// Trigger: khi MR được tạo trên GitLab
// GitLab tự động tạo Review App nếu .gitlab-ci.yml có cấu hình

// .gitlab-ci.yml (trong repo, managed bởi platform team):
// review:
//   stage: review
//   script:
//     - helm upgrade --install preview-$CI_MERGE_REQUEST_IID ...
//   environment:
//     name: preview/$CI_COMMIT_REF_NAME
//     url: https://preview-$CI_MERGE_REQUEST_IID.dev.company.com
//     on_stop: stop_review
//   only: [merge_requests]

// Paperclip lấy preview URL từ GitLab MCP
async function getPreviewUrl(mrId: string, repoPath: string): Promise<string | null> {
  const gitlab = await getGitlabMcpClient(repoPath);
  const mr = await gitlab.call('gitlab.mr.get', { id: mrId });
  return mr.head_pipeline?.web_url
    ? `https://preview-${mrId}.dev.company.com`
    : null;
}

// Paperclip đính preview URL vào issue để QA agent dùng
async function enrichIssueWithPreview(issue: Issue, mrId: string) {
  const previewUrl = await getPreviewUrl(mrId, issue.repoPath);
  if (previewUrl) {
    await db.update(issues).set({
      metadata: { ...issue.metadata, previewUrl, previewMrId: mrId }
    }).where(eq(issues.id, issue.id));

    // Notify QA agent
    await sendAgentMessage(qaAgentId, {
      type: 'preview_ready',
      issueId: issue.id,
      previewUrl,
      testChecklist: await generateQaChecklist(issue),
    });
  }
}
```

### 3.5 QA Flow — Ephemeral + Preview

```
Agent viết code (feature/ATO-512)
    │
    ▼
[Ephemeral Workspace provisioned]
    → docker-compose up (runner server)
    → seed test data
    │
    ▼
[Agent tự test trong workspace]
    → chạy unit + integration tests
    → opensearch: check logs ephemeral cho errors
    → fix errors → re-run
    │
    ▼  (tests pass)
    │
[Workspace destroyed]
    → cleanup ports, volumes
    │
[MR created on GitLab]
    → GitLab CI: lint + test + build + security
    → GitLab CD: create Preview environment (Review App)
    │
    ▼
[Preview URL available]
    → Paperclip notifies QA agent
    → QA agent: chạy E2E tests tại preview URL
    → QA agent: đọc logs tại OpenSearch (logs-preview-*)
    → Human QA (nếu cần): click-test tại preview URL
    │
    ├── QA fails → comment trên MR → agent fixes → re-push → re-test
    └── QA passes → Approval Center item (nếu high-risk)
                 → hoặc auto-merge (low-risk)
    │
    ▼
[MR merged → develop]
    → Preview environment auto-destroyed (GitLab stop_review)
    → GitLab CD: deploy to dev
    → Paperclip monitors dev via OpenSearch
```

### 3.6 Runner MCP Server

```typescript
// MCP server mới: chạy trên shared runner, quản lý docker-compose workspaces
const RUNNER_MCP_TOOLS = {
  'runner.compose.up':     { desc: 'Spin up docker-compose stack for branch' },
  'runner.compose.down':   { desc: 'Tear down workspace and cleanup volumes' },
  'runner.compose.exec':   { desc: 'Execute command in running service container' },
  'runner.compose.logs':   { desc: 'Get stdout/stderr from service container' },
  'runner.compose.health': { desc: 'Check all services healthy' },
  'runner.compose.list':   { desc: 'List active workspaces on this runner' },
  'runner.port.allocate':  { desc: 'Reserve a port block for a workspace' },
  'runner.port.release':   { desc: 'Release port block' },
};
```

```yaml
# Register Runner MCP in Paperclip
name: local-runner-01
type: runner
endpoint: https://runner-01.internal.company.com/mcp
auth:
  type: token
  token_env: RUNNER_MCP_TOKEN
readonly: false
capabilities:
  - docker_compose
max_concurrent_workspaces: 20
port_range: [13000, 14000]   # reserved ports for ephemeral workspaces
```

### 3.2 Environment Schema

```sql
CREATE TABLE project_environments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id),
  repo_id         UUID NOT NULL REFERENCES project_repos(id),

  env_name        TEXT NOT NULL,    -- 'local' | 'dev' | 'stag' | 'live'
  env_type        TEXT NOT NULL,    -- 'docker_compose' | 'k8s'

  -- GitLab config (for k8s envs)
  gitlab_project_id  TEXT,          -- GitLab project ID or path
  gitlab_env_name    TEXT,          -- GitLab environment name (matches k8s namespace)
  deploy_branch      TEXT,          -- which branch triggers CD: 'develop', 'staging', 'main'
  deploy_tag_pattern TEXT,          -- tag pattern for this env: 'stag-*', 'v*.*.*'

  -- OpenSearch config
  opensearch_server_id UUID REFERENCES mcp_servers(id),
  log_index_pattern  TEXT,          -- 'logs-dev-*', 'logs-stag-*', 'logs-live-*'
  service_name_field TEXT DEFAULT 'service',  -- log field for service name
  env_field          TEXT DEFAULT 'environment',

  -- Deployment policy
  auto_deploy        BOOLEAN DEFAULT false,   -- true for dev, false for stag/live
  requires_approval  BOOLEAN DEFAULT true,    -- false for dev
  approval_min_risk  INT DEFAULT 0,           -- min risk score to require approval

  -- Current state (updated by Paperclip)
  current_version    TEXT,           -- deployed git SHA or tag
  last_deployed_at   TIMESTAMPTZ,
  deploy_status      TEXT,           -- 'healthy' | 'degraded' | 'deploying' | 'failed'

  UNIQUE(repo_id, env_name)
);
```

### 3.3 Environment Promotion Flow

```typescript
// Paperclip orchestrates promotion — GitLab executes
async function promoteToEnvironment(
  repoId: string,
  fromEnv: string,
  toEnv: string,
  ref: string        // branch, tag, or commit SHA
) {
  const gitlab = await getMcpClient('gitlab', repoId);
  const targetEnv = await getEnvironment(repoId, toEnv);

  // Step 1: Create promotion MR or tag (depending on env)
  let promotionRef: string;

  if (toEnv === 'stag') {
    // Create tag: stag-20260429-abc123
    const tag = `stag-${dateStamp()}-${ref.slice(0,7)}`;
    await gitlab.call('gitlab.tag.create', { name: tag, ref, message: `Promote to staging` });
    promotionRef = tag;

  } else if (toEnv === 'live') {
    // Create release tag: v1.2.3
    const version = await getNextVersion(repoId);
    await gitlab.call('gitlab.tag.create', { name: version, ref, message: `Release ${version}` });
    await gitlab.call('gitlab.release.create', { tag: version, notes: await generateReleaseNotes(repoId, ref) });
    promotionRef = version;
  }

  // Step 2: Trigger GitLab CD pipeline
  const pipeline = await gitlab.call('gitlab.pipeline.trigger', {
    ref: promotionRef,
    variables: { TARGET_ENV: toEnv },
  });

  // Step 3: Track in Paperclip
  await recordDeployment(repoId, toEnv, promotionRef, pipeline.id);

  // Step 4: Watch pipeline status (poll via GitLab MCP)
  await watchPipelineAndReport(pipeline.id, repoId, toEnv);
}
```

---

## 4. GitLab MCP Integration — Full Agent Workflow

### 4.1 Agent Task Execution Flow (Revised)

```
Issue assigned to agent
    │
    ▼
[Agent reads context]
    → Project Brain (from Paperclip DB)
    → Relevant docs (from tech_docs, api_specs)
    → Existing code via: gitlab.file.read (MCP)
    │
    ▼
[Agent creates branch]
    gitlab.branch.create({
      name: 'feature/ATO-512-dark-mode',
      ref: 'develop'
    })
    │
    ▼
[Agent implements]
    → Multiple gitlab.file.create calls (commit per logical unit)
    → Each commit: meaningful message, reference issue
    │
    ▼
[Pre-MR validation]
    → gitlab.pipeline.get: check branch CI status
    → opensearch.errors.top: check for new errors in dev
    │
    ▼
[Agent creates MR]
    gitlab.mr.create({
      title: 'feat(ATO-512): Add dark mode toggle',
      description: generateMrDescription(task, changes),
      sourceBranch: 'feature/ATO-512-dark-mode',
      targetBranch: 'develop',
      labels: ['feature', 'frontend', 'ATO-512'],
      assigneeId: reviewerAgentGitlabId,
    })
    │
    ▼
[GitLab CI runs automatically]
    → Paperclip polls: gitlab.pipeline.get every 2 min
    → Pipeline stages: lint → test → build → security
    │
    ▼  (all pass)
    │
[QA Agent reviews MR]
    → gitlab.diff.get: read the changes
    → opensearch.logs.tail: check dev logs for errors
    → gitlab.mr.add_comment: leave review comments
    │
    ├── Issues found → agent fixes → new commits → re-review
    └── Approved → gitlab.mr.merge (or Approval Center for high-risk)
    │
    ▼
[GitLab CD auto-deploys to dev]
    → Paperclip watches: gitlab.pipeline.get
    → Paperclip reads: opensearch.logs.tail (dev, 5 min post-deploy)
    → No errors → issue marked done
    → Errors → new issue created
```

### 4.2 GitLab MCP Client (Paperclip side)

```typescript
class GitLabMcpClient {
  constructor(private serverId: string, private repoPath: string) {}

  async call(tool: string, params: Record<string, unknown>) {
    const server = await getMcpServer(this.serverId);
    return await mcpCall(server.endpoint, {
      tool,
      params: { ...params, project: this.repoPath },
      auth: server.authConfig,
    });
  }

  // Convenience methods
  async createBranch(name: string, ref: string = 'develop') {
    return this.call('gitlab.branch.create', { name, ref });
  }

  async commitFile(branch: string, filePath: string, content: string, message: string) {
    return this.call('gitlab.file.create', { branch, filePath, content, commitMessage: message });
  }

  async createMR(params: CreateMRParams) {
    return this.call('gitlab.mr.create', params);
  }

  async watchPipeline(pipelineId: string, timeoutMinutes = 30): Promise<PipelineResult> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMinutes * 60 * 1000) {
      const pipeline = await this.call('gitlab.pipeline.get', { id: pipelineId });
      if (['success', 'failed', 'canceled'].includes(pipeline.status)) {
        return pipeline;
      }
      await sleep(120_000); // poll every 2 minutes
    }
    throw new Error(`Pipeline ${pipelineId} timed out after ${timeoutMinutes} minutes`);
  }
}
```

---

## 5. OpenSearch MCP Integration — Log Intelligence

### 5.1 OpenSearch Index Strategy

```
Index naming convention (agreed with platform team):
  logs-{service}-{env}-{YYYY.MM.dd}

Examples:
  logs-payment-service-live-2026.04.29
  logs-order-service-stag-2026.04.29
  logs-frontend-dev-2026.04.29

Index template (minimum required fields):
  @timestamp      ISO8601
  service         service name
  environment     dev | stag | live
  level           debug | info | warn | error | fatal
  message         log message text
  trace_id        distributed trace ID (for correlation)
  span_id         span ID
  http.method     (for access logs)
  http.path       (for access logs)
  http.status     (for access logs)
  duration_ms     (for performance logs)
  error.type      (for error logs)
  error.message   (for error logs)
  error.stack     (for error logs)
```

### 5.2 OpenSearch MCP Client

```typescript
class OpenSearchMcpClient {
  constructor(private serverId: string, private project: ProjectEnvironmentConfig) {}

  // Get latest errors for a service in an environment
  async getRecentErrors(service: string, env: string, windowMinutes = 30) {
    return this.call('opensearch.errors.top', {
      index: `logs-${service}-${env}-*`,
      timeWindow: `${windowMinutes}m`,
      groupBy: 'error.type',
      limit: 20,
    });
  }

  // Check if deploy was healthy (called after CD pipeline)
  async isDeployHealthy(service: string, env: string, deployedAt: Date): Promise<HealthCheck> {
    const errors = await this.call('opensearch.errors.trend', {
      index: `logs-${service}-${env}-*`,
      from: deployedAt.toISOString(),
      to: new Date().toISOString(),
      interval: '1m',
    });

    const p99 = await this.call('opensearch.latency.p99', {
      index: `logs-${service}-${env}-*`,
      from: deployedAt.toISOString(),
      field: 'duration_ms',
    });

    return {
      healthy: errors.totalCount < 10 && p99 < 1000,
      errorCount: errors.totalCount,
      p99Latency: p99,
      topError: errors.buckets[0]?.key,
    };
  }

  // Agent uses this when investigating a bug
  async investigateIssue(service: string, env: string, issueDescription: string) {
    // LLM generates the OpenSearch query from issue description
    const query = await llm.invoke([
      new SystemMessage(`Convert this bug description into an OpenSearch DSL query.
      Available fields: @timestamp, service, level, message, trace_id, error.type, error.stack,
      http.path, http.status, duration_ms, environment.
      Return ONLY the JSON DSL query.`),
      new HumanMessage(`Service: ${service}, Env: ${env}\nIssue: ${issueDescription}`),
    ]);

    return this.call('opensearch.logs.query', {
      index: `logs-${service}-${env}-*`,
      query: JSON.parse(query.content),
      size: 50,
    });
  }
}
```

### 5.3 Log-Driven Incident Detection

```typescript
// Cron: mỗi 2 phút — thay cho metrics polling trực tiếp
async function detectIncidentsFromLogs(projectId: string) {
  const envs = await getProjectEnvironments(projectId);
  const opensearch = await getOpenSearchClient(projectId);

  for (const env of envs.filter(e => e.envName !== 'local')) {
    const repos = await getProjectRepos(projectId);

    for (const repo of repos) {
      // Check error rate
      const errorRate = await opensearch.call('opensearch.logs.count', {
        index: `logs-${repo.name}-${env.envName}-*`,
        filter: { range: { '@timestamp': { gte: 'now-5m' } }, term: { level: 'error' } },
      });

      const totalRate = await opensearch.call('opensearch.logs.count', {
        index: `logs-${repo.name}-${env.envName}-*`,
        filter: { range: { '@timestamp': { gte: 'now-5m' } } },
      });

      const rate = totalRate > 0 ? errorRate / totalRate : 0;

      // Check alert rules
      const rule = await getAlertRule(repo.id, env.envName, 'error_rate');
      if (rule && rate > rule.threshold) {
        await triggerIncident({
          repoId: repo.id,
          env: env.envName,
          metricType: 'error_rate',
          value: rate,
          threshold: rule.threshold,
          // Include log sample for context
          logSample: await opensearch.getRecentErrors(repo.name, env.envName, 5),
        });
      }
    }
  }
}
```

### 5.4 Agent Log Investigation Tool

Khi agent nhận issue liên quan đến bug trong production/stag:

```typescript
// Tự động inject vào agent context khi issue type = 'bug'
async function enrichBugContext(issue: Issue): Promise<BugContext> {
  const opensearch = await getOpenSearchClient(issue.projectId);
  const affectedService = await inferAffectedService(issue);

  // Search logs around the time bug was reported
  const reportedAt = issue.createdAt;
  const logs = await opensearch.call('opensearch.logs.search', {
    index: `logs-${affectedService}-live-*`,
    query: issue.title,
    timeFrom: subMinutes(reportedAt, 30).toISOString(),
    timeTo: addMinutes(reportedAt, 10).toISOString(),
    size: 30,
  });

  // Get full stack trace if error found
  const errorTraces = logs.hits
    .filter(h => h._source.level === 'error')
    .slice(0, 5)
    .map(h => h._source['error.stack']);

  return {
    affectedService,
    logSample: logs.hits.slice(0, 10).map(h => h._source),
    errorTraces,
    // Agent can query more via opensearch MCP tool directly
    opensearchHint: `Query: logs-${affectedService}-live-* | time: around ${reportedAt.toISOString()}`,
  };
}
```

---

## 6. Revised CI/CD Flow (GitLab-native)

```
Paperclip creates MR (via GitLab MCP)
    │
    ▼ GitLab triggers CI automatically
    │
[GitLab CI Pipeline] — Paperclip polls status
    ├── Stage: lint          (ESLint, Prettier, mypy)
    ├── Stage: test          (unit + integration)
    ├── Stage: build         (Docker image → GitLab Registry)
    ├── Stage: security      (npm audit, truffleHog, Trivy)
    └── Stage: api-contract  (Optic diff — Paperclip installs in GitLab CI)
    │
    ├── FAIL → Paperclip reads stage logs (OpenSearch) → agent fixes → re-push
    └── PASS ↓
    │
[Paperclip: evaluate merge risk]
    → risk_score based on pipeline results + change scope
    → low risk: auto-merge
    → high risk: Approval Center item created
    │
    ▼ (merged to develop)
    │
[GitLab CD: deploy to dev]
    → auto-triggered by GitLab CD
    → Paperclip polls: gitlab.pipeline.get
    │
    ▼ (dev deploy done)
    │
[Paperclip: post-deploy health check]
    → opensearch.isDeployHealthy(service, 'dev', deployedAt)
    → healthy: update issue progress
    → unhealthy: create new bug issue, assign agent
    │
    ▼ (dev stable, promote to stag)
    │
[Human approves stag promotion]
    → Approval Center item: medium risk
    → Paperclip: gitlab.tag.create(stag-YYYYMMDD-sha)
    → GitLab CD: deploy to stag
    │
    ▼ (stag healthy, QA passed)
    │
[Human approves live release]
    → Approval Center item: high risk
    → risk += db_migration? + breaking_change? + first_release?
    → Paperclip: gitlab.tag.create(v1.2.3) + gitlab.release.create
    → GitLab CD: deploy to live (canary pipeline)
    │
    ▼
[Paperclip monitors live via OpenSearch]
    → Error rate, latency checks every 2 min
    → Auto-advance canary nếu healthy
    → Auto-rollback nếu error spike
    → Rollback = gitlab.pipeline.trigger(previous stable tag)
```

---

## 7. Revised Monitoring Architecture

```
K8s Services ──logs──▶ OpenSearch
                            │
                     [Paperclip polls OpenSearch every 2 min]
                            │
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
        error_rate      p99_latency   error_patterns
              │             │              │
              └─────────────┴──────────────┘
                            │ threshold exceeded
                            ▼
                    [Incident created]
                    → Paperclip issue (auto-assign agent)
                    → Agent investigates via OpenSearch MCP
                    → Agent can request rollback (Approval Center)
```

**Paperclip không cần direct access vào K8s** — tất cả thông tin đến từ OpenSearch logs.

---

## 8. Environment Lifecycle — Paperclip's View

| Environment | Runtime | Paperclip manages | Logs source | Deploy trigger | Approval |
|-------------|---------|------------------|-------------|---------------|----------|
| **local-dev** | Docker (laptop) | ❌ không có | — | Developer | — |
| **ephemeral** | Docker (runner) | ✅ full control | OpenSearch `logs-ephemeral-*` | Auto on task start | — |
| **preview** | K8s (per MR) | ✅ via GitLab Review Apps | OpenSearch `logs-preview-*` | Auto on MR open | — |
| **dev** | K8s | ✅ via GitLab MCP | OpenSearch `logs-dev-*` | Auto on merge→develop | ❌ |
| **stag** | K8s | ✅ via GitLab MCP | OpenSearch `logs-stag-*` | Manual (stag-* tag) | ✅ medium |
| **live** | K8s | ✅ via GitLab MCP | OpenSearch `logs-live-*` | Manual (v*.*.* tag) | ✅ high |

```typescript
interface PaperclipEnvironmentCapabilities {
  'local-dev': {
    canRead: false,
    canDeploy: false,
    canMonitor: false,
  },
  ephemeral: {
    canRead: true,        // Runner MCP: logs, exec output
    canDeploy: true,      // Runner MCP: compose up/down
    canMonitor: true,     // OpenSearch ephemeral index
    requiresApproval: false,
    autoProvision: true,  // spin up when task starts
    autoDestroy: true,    // destroy on MR create or 4h idle
  },
  preview: {
    canRead: true,        // OpenSearch preview index
    canDeploy: true,      // via GitLab Review Apps (auto)
    canMonitor: true,
    requiresApproval: false,
    hasPublicUrl: true,   // preview-{mrId}.dev.company.com
    autoDestroy: true,    // destroyed when MR merged/closed
  },
  dev: {
    canRead: true,
    canDeploy: true,      // GitLab MCP: trigger pipeline
    canMonitor: true,
    requiresApproval: false,
    autoMonitor: true,
  },
  stag: {
    canRead: true,
    canDeploy: true,      // GitLab MCP: create stag-* tag
    canMonitor: true,
    requiresApproval: true,
    autoMonitor: true,
  },
  live: {
    canRead: true,
    canDeploy: true,      // GitLab MCP: create v*.*.* tag + release
    canMonitor: true,
    requiresApproval: true,
    autoMonitor: true,
    canAutoRollback: true, // trigger rollback pipeline on error spike
  },
}
```

---

## 9. MCP Server Setup & Configuration

### 9.1 GitLab MCP Server

```yaml
# Paperclip registers this MCP server
name: gitlab-internal
type: gitlab
endpoint: https://mcp.internal.company.com/gitlab
auth:
  type: token
  token_env: GITLAB_MCP_TOKEN    # service account token, read/write access
readonly: false
capabilities:
  - branches
  - merge_requests
  - pipelines
  - files
  - releases
  - tags
scoped_to:
  group: internal-projects       # chỉ access repos trong group này
```

### 9.2 OpenSearch MCP Server

```yaml
name: opensearch-all-envs
type: opensearch
endpoint: https://mcp.internal.company.com/opensearch
auth:
  type: token
  token_env: OPENSEARCH_MCP_TOKEN  # read-only service account
readonly: true                       # NEVER write to OpenSearch
capabilities:
  - search
  - query
  - aggregations
  - count
index_patterns_allowed:
  - logs-*-dev-*
  - logs-*-stag-*
  - logs-*-live-*
# NOT allowed: security logs, user data, PII indices
index_patterns_denied:
  - audit-*
  - user-*
  - pii-*
```

### 9.3 MCP Permission Model

```typescript
// Từng operation được permission-checked
const MCP_PERMISSIONS = {
  // GitLab — write operations cần higher trust level
  'gitlab.branch.create':   { requiredTrustLevel: 'agent' },
  'gitlab.file.create':     { requiredTrustLevel: 'agent' },
  'gitlab.mr.create':       { requiredTrustLevel: 'agent' },
  'gitlab.mr.merge':        { requiredTrustLevel: 'agent', requiresApproval: false },  // pre-approved by gate
  'gitlab.tag.create':      { requiredTrustLevel: 'system', requiresApproval: true },  // approval required
  'gitlab.release.create':  { requiredTrustLevel: 'system', requiresApproval: true },  // approval required
  'gitlab.pipeline.cancel': { requiredTrustLevel: 'system' },

  // OpenSearch — read only, no special permissions
  'opensearch.*':           { requiredTrustLevel: 'agent', readonly: true },
};
```

---

## 10. Data Flow Summary

```
┌──────────────────────────────────────────────────────────────────┐
│                     DATA FLOWS                                    │
│                                                                   │
│  Paperclip ──WRITE──▶ GitLab (branches, commits, MRs, tags)     │
│  Paperclip ◀──READ─── GitLab (pipeline status, MR status)       │
│                                                                   │
│  Paperclip ◀──READ─── OpenSearch (logs, errors, latency)        │
│  (NEVER writes to OpenSearch)                                    │
│                                                                   │
│  GitLab ──DEPLOY──▶ K8s (dev/stag/live)                         │
│  (Paperclip has NO direct K8s access)                            │
│                                                                   │
│  K8s Services ──LOGS──▶ OpenSearch                              │
│  (log shipping managed by platform team)                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## 11. Revised Operations Design (từ Section trước)

Cập nhật `Autonomous-Operations-and-Human-Gate-Design.md`:

| Section cũ | Thay đổi |
|-----------|---------|
| CI/CD Pipeline (self-managed) | → Paperclip **triggers** GitLab CI, không tự chạy CI |
| Metrics collection (self-managed) | → Paperclip **reads** từ OpenSearch, không tự collect |
| Deploy automation | → Paperclip tạo tag/trigger pipeline, **GitLab CD deploys** |
| Rollback | → Paperclip triggers GitLab pipeline với previous stable tag |
| Security scanning | → Chạy trong **GitLab CI**, Paperclip đọc kết quả từ pipeline status |
| Test running | → Chạy trong **GitLab CI**, Paperclip đọc kết quả |

---

## 12. Implementation Roadmap

### Phase 0e — MCP Foundation (2-3 ngày)
- [ ] `mcp_servers` table + CRUD API
- [ ] MCP client wrapper (GitLab + OpenSearch)
- [ ] `project_environments` table + seed ATO environments
- [ ] GitLab MCP server setup (internal, service account)
- [ ] OpenSearch MCP server setup (read-only service account)

### Phase 1e — GitLab Integration (3-4 ngày)
- [ ] Agent workflow: branch create via GitLab MCP
- [ ] Agent workflow: file commits via GitLab MCP
- [ ] Agent workflow: MR creation via GitLab MCP
- [ ] Pipeline watcher: poll status + report to Paperclip
- [ ] Promotion flow: tag create → GitLab CD trigger

### Phase 2e — OpenSearch Integration (2-3 ngày)
- [ ] Post-deploy health check (OpenSearch log polling)
- [ ] Incident detection from logs (replace direct metrics polling)
- [ ] Bug context enrichment (OpenSearch log injection into agent payload)
- [ ] Agent investigation tool (opensearch MCP available in agent context)

### Phase 3e — Environment Dashboard (2 ngày)
- [ ] Environment status UI (current version, last deploy, health)
- [ ] Promotion flow UI (dev → stag → live with approval gates)
- [ ] Log viewer (embedded OpenSearch query results in Paperclip)

---

## 13. Liên kết

- [[Autonomous-Operations-and-Human-Gate-Design]] — Approval Center, CI/CD, monitoring (revised by this doc)
- [[Development-Flow-and-Release-Strategy]] — Branch strategy, feature flags, release
- [[Knowledge-Base-Management-Strategy]] — Repo registry, tech docs
