---
title: Development Flow & Release Strategy
tags: [architecture, git-strategy, feature-flags, design-lifecycle, release, conflict-management]
created: 2026-04-29
status: design
related: "[[Knowledge-Base-Management-Strategy]], [[Autonomous-PM-Strategic-Loop-Design]]"
---

# Development Flow & Release Strategy

> Thiết kế chiến lược quản lý luồng phát triển: từ khi có thiết kế mới đến lúc deploy production, bao gồm xung đột thiết kế, quản lý branch cho AI agents, feature flags, và selective release.

---

## 1. Bốn Vấn Đề Cốt Lõi

```
┌─────────────────────┐  ┌─────────────────────┐
│  Problem 1          │  │  Problem 2          │
│  DESIGN LIFECYCLE   │  │  IN-FLIGHT CONFLICT  │
│                     │  │                     │
│ Thiết kế mới cần    │  │ Design A 50% done,  │
│ tech mới, repo mới  │  │ Design B đến đá     │
│ nhưng chưa implement│  │ vào cùng component  │
└─────────────────────┘  └─────────────────────┘

┌─────────────────────┐  ┌─────────────────────┐
│  Problem 3          │  │  Problem 4          │
│  BRANCH STRATEGY    │  │  SELECTIVE RELEASE  │
│                     │  │                     │
│ Nhiều agents làm    │  │ 10 features done,   │
│ song song, branch   │  │ human muốn golive   │
│ conflict, rebase    │  │ chỉ 1 feature trước │
└─────────────────────┘  └─────────────────────┘
```

---

## 2. Design Lifecycle Management

> Thiết kế phải được quản lý như code — có version, có state, có conflict detection.

### 2.1 Design States

```
                ┌──────────┐
                │  DRAFT   │  ← RFC mới tạo, chưa ai review
                └────┬─────┘
                     │ team review
                     ▼
                ┌──────────┐
                │ REVIEWED │  ← đã review, feedback incorporated
                └────┬─────┘
                     │ approved by human/CTO agent
                     ▼
                ┌──────────┐
           ┌───│ APPROVED │  ← sẵn sàng để implement
           │   └────┬─────┘
           │        │ first task created
           │        ▼
     conflict       ┌─────────────┐
     detected  ┌───│ IN_PROGRESS │  ← đang implement (1+ tasks)
           │   │   └────┬────────┘
           │   │        │ all tasks done
           │   │        ▼
           │   │   ┌─────────────┐
           │   │   │ IMPLEMENTED │  ← fully shipped
           │   │   └────┬────────┘
           │   │        │ superseded by newer design
           │   │        ▼
           │   │   ┌─────────────┐
           └───┴──▶│ DEPRECATED  │
                   └─────────────┘
```

### 2.2 Design Document Schema

```sql
CREATE TABLE design_docs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id),

  -- Identity
  title           TEXT NOT NULL,
  design_type     TEXT NOT NULL,
  -- 'feature'        — new user-facing feature
  -- 'tech_upgrade'   — new tech/library/repo added
  -- 'refactor'       — internal change, no user-facing change
  -- 'architecture'   — system-level design change
  -- 'integration'    — new external system
  -- 'breaking_change'— changes existing behavior

  -- Scope — what this design touches
  affected_repos    JSONB DEFAULT '[]',   -- ["payment-service", "frontend"]
  affected_apis     JSONB DEFAULT '[]',   -- ["/api/payments", "/api/orders"]
  affected_components JSONB DEFAULT '[]', -- ["CheckoutFlow", "PaymentService"]
  new_tech_required JSONB DEFAULT '[]',   -- ["Redis", "Stripe SDK v4"]
  new_repos_required JSONB DEFAULT '[]',  -- ["notification-service"]

  -- Content
  body            TEXT NOT NULL,          -- full RFC/design doc (markdown)
  decision_rationale TEXT,               -- why this approach over alternatives

  -- State
  status          TEXT DEFAULT 'draft',
  version         INT DEFAULT 1,          -- bumped on each significant edit

  -- Relationships
  supersedes_id   UUID REFERENCES design_docs(id),  -- replaces older design
  depends_on      JSONB DEFAULT '[]',    -- other design_doc IDs this depends on

  -- Implementation tracking
  linked_issues   JSONB DEFAULT '[]',    -- Paperclip issue IDs
  impl_progress   INT DEFAULT 0,         -- 0-100%

  -- Conflict tracking
  conflicts_with  JSONB DEFAULT '[]',    -- [{design_id, conflict_type, description}]
  conflict_status TEXT DEFAULT 'none',   -- 'none' | 'detected' | 'resolved'

  created_by      TEXT,
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
```

### 2.3 New Design Intake Flow

Khi Strategic Loop hoặc human tạo design mới:

```typescript
async function intakeNewDesign(draft: DesignDraft) {
  // 1. Conflict detection — ngay khi draft được tạo
  const conflicts = await detectDesignConflicts(draft);

  // 2. Dependency check — design này cần design khác done trước không?
  const blockedBy = await checkDesignDependencies(draft);

  // 3. Tech/repo validation — công nghệ mới có conflict với ADRs không?
  const techConflicts = await validateTechChoices(draft.newTechRequired);

  // 4. Save với đầy đủ context
  const design = await db.insert(designDocs).values({
    ...draft,
    conflictsWith: conflicts,
    conflictStatus: conflicts.length > 0 ? 'detected' : 'none',
    dependsOn: blockedBy,
    status: conflicts.length > 0 ? 'draft' : 'reviewed', // auto-block nếu conflict
  });

  // 5. Notify nếu conflict detected
  if (conflicts.length > 0) {
    await sendInboxAlert({
      title: `Design conflict detected: "${draft.title}"`,
      body: `Conflicts with ${conflicts.length} in-progress design(s). Review required.`,
      link: `/designs/${design.id}`,
    });
  }

  return design;
}
```

---

## 3. Conflict Detection Engine

> Khi design mới đến, tự động so sánh với mọi design đang `IN_PROGRESS`.

### 3.1 Conflict Types

```typescript
const CONFLICT_TYPES = {
  // Code conflicts
  'same_file':      'Cả hai design sửa cùng file/component',
  'same_api':       'Cả hai thay đổi cùng API endpoint',
  'same_schema':    'Cả hai thay đổi cùng DB table/column',

  // Architecture conflicts
  'tech_conflict':  'Design A dùng Redis, Design B loại bỏ Redis',
  'adr_violation':  'Design vi phạm ADR đã được approved',
  'dep_conflict':   'Design thêm lib version X, hiện có lib version Y',

  // Logical conflicts
  'behavior_conflict': 'Design A thay đổi behavior mà Design B đang depend vào',
  'scope_overlap':     'Cả hai implement cùng business logic theo cách khác nhau',
};
```

### 3.2 Conflict Detection Algorithm

```typescript
async function detectDesignConflicts(newDesign: DesignDraft): Promise<Conflict[]> {
  // Lấy tất cả designs đang IN_PROGRESS hoặc APPROVED
  const activeDesigns = await db.select().from(designDocs)
    .where(inArray(designDocs.status, ['approved', 'in_progress']));

  const conflicts: Conflict[] = [];

  for (const existing of activeDesigns) {
    // Check 1: Overlap trong affected_repos
    const repoOverlap = intersection(newDesign.affectedRepos, existing.affectedRepos);
    const apiOverlap  = intersection(newDesign.affectedApis, existing.affectedApis);
    const compOverlap = intersection(newDesign.affectedComponents, existing.affectedComponents);

    if (apiOverlap.length > 0) {
      conflicts.push({
        conflictType: 'same_api',
        withDesignId: existing.id,
        withDesignTitle: existing.title,
        description: `Both designs modify: ${apiOverlap.join(', ')}`,
        severity: 'high',
      });
    }

    if (compOverlap.length > 0) {
      conflicts.push({
        conflictType: 'same_file',
        withDesignId: existing.id,
        description: `Both designs touch: ${compOverlap.join(', ')}`,
        severity: 'medium',
      });
    }

    // Check 2: Tech conflicts — LLM judge
    if (newDesign.newTechRequired.length > 0 || existing.newTechRequired.length > 0) {
      const techConflict = await llm.invoke([
        new SystemMessage(`Detect if these two designs have technology conflicts.
        A conflict exists if: one adds tech the other removes, or they use incompatible versions,
        or their architectural approaches are fundamentally different.
        Reply with JSON: { hasConflict: bool, description: string, severity: "high"|"medium"|"low" }`),
        new HumanMessage(JSON.stringify({
          designA: { title: newDesign.title, tech: newDesign.newTechRequired, body: newDesign.body.slice(0,500) },
          designB: { title: existing.title, tech: existing.newTechRequired, body: existing.body.slice(0,500) },
        })),
      ]);
      const result = JSON.parse(extractJson(techConflict.content));
      if (result.hasConflict) conflicts.push({ conflictType: 'tech_conflict', ...result });
    }
  }

  // Check 3: ADR violations
  const adrs = await getApprovedAdrs(newDesign.projectId);
  const adrViolation = await checkAdrCompliance(newDesign, adrs);
  if (adrViolation) conflicts.push(adrViolation);

  return conflicts;
}
```

### 3.3 Conflict Resolution UI

```
┌─────────────────────────────────────────────────────────┐
│  CONFLICT DETECTED                                       │
│                                                          │
│  New Design: "Add Redis caching layer"                  │
│  Conflicts with: "Remove Redis — migrate to DB cache"   │
│                  (status: IN_PROGRESS, 40% done)        │
│                                                          │
│  Conflict type: tech_conflict (HIGH)                    │
│  "Both designs make incompatible decisions about Redis" │
│                                                          │
│  Resolution options:                                     │
│  ○ Pause "Remove Redis" — wait for new design decision  │
│  ○ Cancel "Add Redis" — keep existing direction         │
│  ○ Merge designs — create unified approach              │
│  ○ Sequence — do "Remove Redis" first, then revisit     │
│                                                          │
│  [Request Design Review Meeting]  [Auto-resolve with AI]│
└─────────────────────────────────────────────────────────┘
```

---

## 4. Branch Strategy cho AI Agents

> Nhiều agents làm song song — cần chiến lược branch rõ ràng để tránh chaos.

### 4.1 Branch Naming Convention

> **UPDATE 2026-04-29:** branch model đã refactor sang trunk-based + tag-driven. Promote env (`dev`/`stag`/`live`) bằng env-pointer tag, **không** bằng long-lived branch. `release/<major>.<minor>.x` chỉ tạo khi cần maintain version cũ song song. Chi tiết: [[Git-Branch-Tag-Release-Train-Strategy]] §3.

```
main                                       ← always deployable, mọi commit có thể trở thành tag
  │
  ├── feature/ATO-512-dark-mode            ← agent branch per issue (< 7 ngày)
  ├── feature/ATO-513-export-async         ← agent branch per issue
  ├── feature/ATO-514-bulk-actions         ← agent branch per issue
  │
  ├── fix/ATO-530-checkout-crash           ← bug fix non-urgent (< 3 ngày)
  ├── hotfix/INC-789-login-crash           ← production critical (< 1 ngày)
  │
  └── design/ATO-D12-redis-caching         ← design prototype, không merge

Long-lived (chỉ tạo khi cần multi-version maintenance):
  release/2.3.x                            ← maintain v2.3.* sau khi v2.4 ra
  release/2.4.x                            ← maintain v2.4.* sau khi v3.0 ra

Tags (immutable):
  v2.4.0, v2.4.1, ...                      ← per-repo SemVer
  trains/2026.04.W17.r3                    ← cross-repo Release Train
  env/dev, env/stag, env/live              ← env pointer tags (movable)
```

### 4.2 Agent Branch Lifecycle

```
Issue assigned to agent
    │
    ▼
[create branch]
  git checkout -b feature/ATO-{id}-{slug} origin/main
    │
    ▼
[agent works]
  → commits thường xuyên với message rõ ràng
  → rebase on main mỗi ngày (tránh drift)
    │
    ▼
[pre-PR gate] — tự động chạy trước khi tạo PR
  ✓ Tests pass
  ✓ No linting errors
  ✓ Coverage không giảm > 5%
  ✓ No breaking API changes (Optic check)
  ✓ No merge conflicts với main
    │
    ▼
[create PR]
  → PR description tự động generate từ commits
  → Link về Paperclip issue
  → Tag: affected repos, design_doc ref
    │
    ▼
[PR review] — tùy config
  Option A: Auto-merge nếu all gates pass
  Option B: Human review required (cho P0/P1 issues)
  Option C: Peer agent review (QA agent reviews)
    │
    ▼
[merge & cleanup]
  → squash merge vào main (clean history)
  → delete feature branch
  → issue marked done
  → Knowledge Base updated (PR webhook)
```

### 4.3 Conflict Prevention Rules

```typescript
// Rules được enforce bởi Branch Manager service
const BRANCH_RULES = {
  // Max số agent làm cùng 1 file
  maxAgentsPerFile: 1,

  // Nếu agent A đang sửa file X, agent B không được nhận task sửa file X
  fileConflictStrategy: 'queue', // 'queue' | 'reject' | 'warn'

  // Rebase frequency
  rebaseOnMain: 'daily', // agents auto-rebase mỗi ngày

  // Max branch age trước khi flag
  maxBranchAgeDays: 7, // sau 7 ngày chưa merge → alert

  // Stale branch cleanup
  deleteStaleBranchAfterDays: 14,
};

// Branch Manager — chạy trước khi assign task
async function canAgentStartTask(task: Issue, agent: Agent): Promise<BranchCheck> {
  const taskFiles = await predictAffectedFiles(task); // LLM predict

  // Check xem có agent nào đang sửa files này không
  const activeBranches = await getActiveBranches(task.projectId);
  for (const branch of activeBranches) {
    const branchFiles = await getBranchAffectedFiles(branch);
    const overlap = intersection(taskFiles, branchFiles);

    if (overlap.length > 0) {
      return {
        canStart: false,
        reason: `Files ${overlap.join(', ')} currently being modified in ${branch.name}`,
        waitFor: branch.issueId,
        estimatedUnblock: branch.estimatedDoneAt,
      };
    }
  }

  return { canStart: true };
}
```

### 4.4 Daily Rebase Strategy

```typescript
// Cron: chạy mỗi sáng
async function rebaseAllActiveBranches() {
  const branches = await getActiveBranches();

  for (const branch of branches) {
    const result = await git.rebase(branch.name, 'main');

    if (result.hasConflicts) {
      // Notify agent để resolve
      await sendAgentMessage(branch.agentId, {
        type: 'rebase_conflict',
        branch: branch.name,
        conflictFiles: result.conflictFiles,
        instruction: 'Please resolve rebase conflicts and push.',
      });
    }
  }
}
```

---

## 5. Selective Release Strategy

> 10 features done, human muốn go-live 1 feature trước — không force deploy tất cả.

### 5.1 Feature Flag System

Mọi feature mới đều được wrap trong feature flag:

```typescript
// Mỗi feature có 1 flag entry trong DB
CREATE TABLE feature_flags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id),

  flag_key      TEXT NOT NULL UNIQUE,   -- "enable_dark_mode", "enable_bulk_export"
  design_doc_id UUID REFERENCES design_docs(id),
  issue_ids     JSONB DEFAULT '[]',     -- linked Paperclip issues

  -- Rollout control
  status        TEXT DEFAULT 'off',
  -- 'off'          — not deployed / hidden
  -- 'internal'     — visible to internal team only
  -- 'beta'         — visible to beta users
  -- 'canary'       — 5-10% of production traffic
  -- 'on'           — fully live

  rollout_pct   INT DEFAULT 0,          -- % of users seeing this feature
  allowed_users JSONB DEFAULT '[]',     -- specific user IDs (for beta)
  allowed_envs  JSONB DEFAULT '["dev","staging"]',

  -- Dependencies
  requires_flags JSONB DEFAULT '[]',   -- flag keys that must be ON first

  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),

  UNIQUE(project_id, flag_key)
);
```

**Dùng trong code:**
```typescript
// Backend
if (await featureFlag.isEnabled('enable_bulk_export', userId)) {
  return handleBulkExport(req);
}

// Frontend
{flags.enable_dark_mode && <DarkModeToggle />}
```

### 5.2 Release Decision Matrix

```
10 features done → human wants to release Feature #3 first

Step 1: Check feature dependencies
  Feature #3 (bulk export) requires_flags: ["async_jobs"] ✅ (already ON)
  → No blocking dependencies

Step 2: Check branch status
  feature/ATO-512 → merged ✅
  All related PRs → merged ✅

Step 3: Check test coverage
  Bulk export coverage: 87% ✅
  Integration tests: pass ✅

Step 4: Choose release strategy
  Option A: Direct flag flip  → set feature_flag.status = 'on'
  Option B: Canary rollout   → 5% → 25% → 100% with metric gates
  Option C: Beta release     → specific users first
  Option D: Release branch   → create release/v1.1.0 with only this feature

→ Human selects Option B (canary)
```

### 5.3 Release Branch Strategy

> **DEPRECATED 2026-04-29.** Pattern "tạo `release/v1.1.0` rồi cherry-pick một số feature" thay bằng **Release Train** + **feature flag-based selective enable**. Lý do: cherry-pick lung tung trong N repo gây divergence và breaking-change vô hình. Cách mới: tất cả feature merge vào `main`, mỗi feature gắn flag, Train pickup mọi repo SHAs hiện tại, promote enable flag theo cohort canary. Doc canonical: [[Git-Branch-Tag-Release-Train-Strategy]] §5 (Release Train). Section dưới đây giữ lại cho lịch sử + edge case multi-version maintenance (xem `[[Git-Branch-Tag-Release-Train-Strategy]] §9`).

Khi muốn release nhiều features nhưng không phải tất cả:

```bash
# Tạo release branch từ main
git checkout -b release/v1.1.0 main

# Cherry-pick chỉ commits của Feature #3 + Feature #7
git cherry-pick <bulk-export-commits>
git cherry-pick <dark-mode-commits>

# KHÔNG cherry-pick Feature #1, #2, #4-6, #8-10

# Test release branch
# Deploy release/v1.1.0 to staging → production
```

**Automated bởi Release Manager:**
```typescript
async function createSelectiveRelease(releaseConfig: ReleaseConfig) {
  const { version, includedFeatures, baseRef } = releaseConfig;

  // 1. Tạo release branch
  await git.createBranch(`release/${version}`, baseRef);

  // 2. Cherry-pick commits cho từng feature được chọn
  for (const featureId of includedFeatures) {
    const commits = await getFeatureCommits(featureId);
    const result  = await git.cherryPick(commits, `release/${version}`);

    if (result.hasConflicts) {
      return {
        success: false,
        reason: `Cherry-pick conflict for feature ${featureId}`,
        conflictFiles: result.conflictFiles,
      };
    }
  }

  // 3. Generate release notes (LLM)
  const releaseNotes = await generateReleaseNotes(includedFeatures);

  // 4. Create PR: release/v1.1.0 → main
  await createPr({
    from: `release/${version}`,
    to: 'main',
    title: `Release ${version}`,
    body: releaseNotes,
    labels: ['release'],
  });

  return { success: true, branch: `release/${version}` };
}
```

### 5.4 Canary Rollout với Metric Gates

```typescript
const CANARY_PLAN = [
  { pct: 5,   waitHours: 1,  metrics: { errorRate: '<1%', p99Latency: '<500ms' } },
  { pct: 25,  waitHours: 4,  metrics: { errorRate: '<1%', p99Latency: '<500ms' } },
  { pct: 50,  waitHours: 12, metrics: { errorRate: '<0.5%', p99Latency: '<400ms' } },
  { pct: 100, waitHours: 0,  metrics: {} }, // full rollout
];

// DevOps agent tự động advance canary nếu metrics OK
// Tự động rollback nếu metrics vượt threshold
async function advanceCanary(flagKey: string, currentStage: number) {
  const plan    = CANARY_PLAN[currentStage];
  const metrics = await getFeatureMetrics(flagKey, '1h');

  if (metrics.errorRate > parseThreshold(plan.metrics.errorRate)) {
    // Auto-rollback
    await setFeatureFlag(flagKey, { rolloutPct: 0, status: 'off' });
    await createIssue({
      title: `[CANARY ROLLBACK] ${flagKey} — error rate ${metrics.errorRate}`,
      priority: 'urgent',
    });
    return;
  }

  // Advance to next stage
  await setFeatureFlag(flagKey, { rolloutPct: CANARY_PLAN[currentStage + 1].pct });
}
```

---

## 6. Managing In-flight Designs vs New Requirements

> Design A đang implement 50%, Design B mới đến đá vào cùng chỗ — xử lý như nào?

### 6.1 Decision Framework

```
New requirement arrives
    │
    ▼
[Is it a bug fix?]
  YES → create fix branch, doesn't need design freeze → go
  NO  ↓
    │
[Does it conflict with in-progress design?]
  NO  → create new design, proceed normally → go
  YES ↓
    │
[What's the conflict severity?]
    │
    ├── LOW (different files, same feature area)
    │   → Both proceed, add integration tests at merge
    │
    ├── MEDIUM (same component, different behavior)
    │   → Queue new requirement until Design A hits milestone
    │   → Set status: 'approved' (not in_progress yet)
    │
    └── HIGH (fundamentally incompatible)
        → Pause one, choose which:
          • Is new requirement P0 (critical)?
            YES → pause Design A, ship new requirement first
            NO  → queue new requirement
```

### 6.2 Design Freeze Zones

Khi một component đang được refactor nặng, lock nó:

```sql
CREATE TABLE component_locks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id),

  component_name  TEXT NOT NULL,         -- "CheckoutService", "PaymentController"
  repo_name       TEXT NOT NULL,
  file_paths      JSONB DEFAULT '[]',    -- specific files locked

  locked_by_design UUID REFERENCES design_docs(id),
  locked_by_issue  UUID REFERENCES issues(id),

  lock_type       TEXT DEFAULT 'soft',
  -- 'soft'  → warn other agents, but allow with override
  -- 'hard'  → block other agents from touching this component

  reason          TEXT,
  estimated_unlock TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

```typescript
// Trước khi agent bắt đầu task
async function checkComponentLocks(task: Issue): Promise<LockCheck> {
  const predictedFiles = await predictAffectedFiles(task);
  const locks = await getActiveLocks(task.projectId);

  for (const lock of locks) {
    const overlap = intersection(predictedFiles, lock.filePaths);
    if (overlap.length > 0 && lock.lockType === 'hard') {
      return {
        blocked: true,
        reason: `${lock.componentName} is locked by design "${lock.lockedByDesignTitle}"`,
        estimatedUnlock: lock.estimatedUnlock,
      };
    }
  }
  return { blocked: false };
}
```

---

## 7. Full Workflow — Từ Idea đến Production

```
NEW IDEA / REQUIREMENT
    │
    ▼
[1. Create Design Doc]          (human hoặc Strategic Loop)
    → auto conflict detection
    → auto ADR compliance check
    → assign: draft → reviewed → approved
    │
    ▼
[2. Design Approved]
    → Break down thành issues (Strategic Loop)
    → Each issue linked to design_doc
    → feature_flag key created (default: off)
    │
    ▼
[3. Agent Execution]
    → Check component locks
    → Check file conflicts
    → Create feature branch
    → Implement behind feature flag
    → Daily rebase on main
    │
    ▼
[4. PR Created]
    → Pre-PR gate: tests, coverage, API contract
    → Auto or human review
    → Merge → Knowledge Base updated
    │
    ▼
[5. All Issues Done]
    → Feature flag: off → internal testing
    → QA agent runs integration tests
    → Design status: implemented
    │
    ▼
[6. Release Decision]            (human approves)
    → Choose: feature flag flip vs release branch
    → Choose rollout: direct / canary / beta
    │
    ▼
[7. Canary Rollout]
    → 5% → 25% → 50% → 100%
    → Auto-advance if metrics OK
    → Auto-rollback if anomaly detected
    │
    ▼
[8. Full Production]
    → feature_flag.status = 'on'
    → Release notes published
    → Customer signals collection begins for this feature
    → Auditor tracks outcome in task_outcomes
```

---

## 8. Database Schema Summary

```sql
-- Đã có (Section 18):
--   project_repos, repo_dependencies, tech_docs, api_specs, doc_coverage_gaps

-- Mới trong document này:
design_docs          -- design lifecycle management
component_locks      -- prevent concurrent modifications
feature_flags        -- control rollout per feature
```

---

## 9. Implementation Roadmap

### Phase 0c — Design Management (2-3 ngày)
- [ ] `design_docs` table + CRUD API
- [ ] Design Doc UI trong Paperclip (create/edit/approve)
- [ ] Link design → issues (2-way)
- [ ] Basic conflict detection (repo/API overlap)

### Phase 1c — Branch Governance (2 ngày)
- [ ] Branch naming convention enforced in agent workflow
- [ ] Pre-PR gate pipeline (tests + coverage + Optic)
- [ ] `canAgentStartTask()` — file conflict check
- [ ] Daily rebase cron

### Phase 2c — Feature Flags (2-3 ngày)
- [ ] `feature_flags` table + API
- [ ] Feature flag SDK (backend + frontend)
- [ ] Flag management UI
- [ ] `component_locks` table

### Phase 3c — Selective Release (3-4 ngày)
- [ ] Release Manager: cherry-pick pipeline
- [ ] Canary rollout controller
- [ ] Metric gate evaluation (link to monitoring)
- [ ] Release notes generator (LLM)
- [ ] Rollback automation

---

## 10. Liên kết

- [[Knowledge-Base-Management-Strategy]] — repo registry, tech docs, API specs
- [[Autonomous-PM-Strategic-Loop-Design]] — Strategic Loop, Auditor, Efficiency Reviewer
- [[Git-Branch-Tag-Release-Train-Strategy]] — Train + env pointer + hotfix worktree
