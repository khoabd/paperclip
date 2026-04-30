---
title: Autonomous PM & Strategic Loop — Complete Design
tags: [architecture, strategic-loop, langchain, product-management, autonomous]
created: 2026-04-29
status: design
---

# Autonomous PM & Strategic Loop — Complete Design

> Thiết kế hệ thống tự quản lý sản phẩm hoàn toàn: từ thu thập feedback, research thị trường, lên kế hoạch sprint, đến thực thi và học hỏi — với human-in-the-loop approval.

---

## 1. Tổng quan kiến trúc

```
┌─────────────────────────────────────────────────────────────────┐
│                        PAPERCLIP PLATFORM                        │
│                                                                   │
│  ┌─────────────────┐     ┌──────────────────────────────────┐   │
│  │   PROJECT BRAIN  │────▶│         STRATEGIC LOOP           │   │
│  │  (PostgreSQL)    │     │    (LangGraph Supervisor Graph)  │   │
│  │                  │◀────│                                  │   │
│  │ • goal           │     │  collect → analyze → research    │   │
│  │ • phase          │     │      → plan → interrupt          │   │
│  │ • decisions      │     │          → execute → learn       │   │
│  │ • known_gaps     │     │                                  │   │
│  │ • metrics        │     └──────────────┬───────────────────┘   │
│  │ • signals        │                    │ creates issues         │
│  └─────────────────┘                    ▼                        │
│                              ┌──────────────────┐                │
│                              │  EXECUTION LAYER  │                │
│                              │  (Dept Agents)    │                │
│                              │                   │                │
│                              │ Engineering  QA   │                │
│                              │ DevOps    Design  │                │
│                              │ Support   Data/ML │                │
│                              └──────────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Project Brain — Bộ nhớ dài hạn

### 2.1 Database Schema

```sql
CREATE TABLE project_brain (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id),
  project_id    UUID NOT NULL REFERENCES projects(id),
  
  -- Product identity
  goal          TEXT NOT NULL,           -- "Build FCTCAI v2 — AI factory floor, ship by Q3 2026"
  vision        TEXT,                    -- long-term 3-year vision
  phase         TEXT NOT NULL,           -- "core_agents_mvp" | "growth" | "scale" | "mature"
  
  -- Context
  decisions     JSONB DEFAULT '[]',      -- ADRs: [{date, title, rationale, status}]
  known_gaps    JSONB DEFAULT '[]',      -- ["no memory persistence", "no project context"]
  constraints   JSONB DEFAULT '[]',      -- ["no Temporal", "Python only", "budget $500/mo"]
  
  -- Codebase state (auto-updated)
  codebase_state JSONB DEFAULT '{}',     -- {test_coverage, last_deploy, tech_stack, file_count}
  
  -- Product metrics (synced from analytics)
  metrics       JSONB DEFAULT '{}',      -- {wau, retention_d30, nps, churn_rate, arr}
  
  -- Sprint tracking
  current_sprint JSONB DEFAULT '{}',     -- {name, goal, start_date, end_date}
  velocity       FLOAT DEFAULT 0,        -- avg tasks completed per sprint
  
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id)
);

CREATE TABLE product_signals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id),
  
  source        TEXT NOT NULL,   -- "support_ticket" | "app_review" | "churn" | "nps" | "feature_request" | "market_research"
  content       TEXT NOT NULL,   -- raw text
  sentiment     TEXT,            -- "positive" | "negative" | "neutral"
  theme         TEXT,            -- clustered theme: "slow export", "missing bulk action"
  priority_score FLOAT,          -- 0-1, computed by Loop
  revenue_impact TEXT,           -- "$12k ARR at risk"
  churn_risk    TEXT,            -- "high" | "medium" | "low"
  
  raw_metadata  JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### 2.2 Seeding (Manual khởi đầu)

```typescript
// POST /companies/:cid/projects/:pid/brain/seed
{
  goal: "Build FCTCAI — AI company simulation platform, ship v1 by Q3 2026",
  vision: "Every startup can have a fully autonomous AI team that ships product",
  phase: "core_agents_mvp",
  decisions: [
    { date: "2026-04-24", title: "Pure LangGraph stack", rationale: "No Temporal overhead at current scale" },
    { date: "2026-04-25", title: "Multi-department model", rationale: "Mirrors real org structure, easier to reason about" }
  ],
  known_gaps: [
    "no persistent memory across agent runs",
    "no project context injected into agents",
    "no customer feedback loop",
    "adapter fallback not wired"
  ],
  constraints: ["Python 3.11+", "LangGraph only", "budget $200/mo LLM"],
  current_sprint: {
    name: "Sprint 5 — Foundation Fixes",
    goal: "Fix adapter fallback, add project context, unblock stale issues",
    start_date: "2026-04-28",
    end_date: "2026-05-05"
  }
}
```

---

## 3. Signal Collection Layer

### 3.1 Signal Sources

| Source | Method | Frequency | Priority |
|--------|--------|-----------|----------|
| **Human intake** (problem/feature_request/bug_report/feedback/strategic_input/question) | Console / email / mobile / API → `intake_items` table | Realtime | **HIGH** (P0/P1 preempts sprint) |
| Support tickets | Webhook / API pull | Realtime | HIGH |
| App Store reviews | Scrape / API | Daily | MEDIUM |
| NPS surveys | Webhook | On submission | HIGH |
| Churn interviews | Manual paste / API | Weekly | HIGH |
| Feature requests | Linear/Canny webhook | Realtime | MEDIUM |
| Competitor releases | RSS + Tavily search | Daily | MEDIUM |
| Industry news | Tavily search | Daily | LOW |
| GitHub trending | GitHub API | Weekly | LOW |
| Research papers | arXiv API | Weekly | LOW |
| Feedback cluster promoted (DBSCAN ≥5/14d) | Internal cron | Daily | HIGH |

→ `human_intake` is a **first-class signal source** (xem [[Human-Intake-and-Solution-Loop-Design]] §10.1). When `intake.created` fires, the signal collector ingests it directly into `signals` queue with source=`human_intake`; planSprintNode (§4.4) considers P0/P1 intakes for mid-sprint preemption.

### 3.2 Signal Processor Node

```typescript
async function collectSignalsNode(state: StrategicState) {
  const since = subDays(new Date(), 7);
  
  const [tickets, reviews, churnReasons, featureRequests] = await Promise.all([
    fetchSupportTickets({ projectId: state.projectId, since }),
    fetchAppReviews({ appId: state.brain.appStoreId, since }),
    fetchChurnReasons({ projectId: state.projectId, since }),
    fetchFeatureRequests({ projectId: state.projectId, since }),
  ]);
  
  // Persist raw signals
  await db.insert(productSignals).values([
    ...tickets.map(t => ({ projectId: state.projectId, source: "support_ticket", content: t.body })),
    ...reviews.map(r => ({ projectId: state.projectId, source: "app_review", content: r.text })),
  ]);
  
  return { rawSignals: [...tickets, ...reviews, ...churnReasons, ...featureRequests] };
}
```

---

## 4. Strategic Loop — LangGraph Graph

### 4.1 Full Graph Definition

```typescript
import { StateGraph, Annotation, interrupt } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const StrategicState = Annotation.Root({
  projectId:     Annotation<string>(),
  brain:         Annotation<ProjectBrain>(),
  rawSignals:    Annotation<Signal[]>({ default: () => [] }),
  themes:        Annotation<Theme[]>({ default: () => [] }),
  research:      Annotation<ResearchResult>({ default: () => ({}) }),
  proposals:     Annotation<TaskProposal[]>({ default: () => [] }),
  approvedTasks: Annotation<TaskProposal[]>({ default: () => [] }),
  weeklyDigest:  Annotation<string>({ default: () => "" }),
  iteration:     Annotation<number>({ default: () => 0 }),
});

const graph = new StateGraph(StrategicState)
  .addNode("load_brain",       loadBrainNode)
  .addNode("collect_signals",  collectSignalsNode)
  .addNode("analyze_signals",  analyzeSignalsNode)
  .addNode("research_market",  researchMarketNode)
  .addNode("plan_sprint",      planSprintNode)
  .addNode("human_approval",   humanApprovalNode)     // interrupt()
  .addNode("execute_plan",     executePlanNode)
  .addNode("update_brain",     updateBrainNode)
  .addNode("send_digest",      sendDigestNode)

  .addEdge("__start__",        "load_brain")
  .addEdge("load_brain",       "collect_signals")
  .addEdge("collect_signals",  "analyze_signals")
  .addEdge("analyze_signals",  "research_market")
  .addEdge("research_market",  "plan_sprint")
  .addEdge("plan_sprint",      "human_approval")
  .addEdge("human_approval",   "execute_plan")        // resumes after user approves
  .addEdge("execute_plan",     "update_brain")
  .addEdge("update_brain",     "send_digest")
  .addEdge("send_digest",      "__end__")
  .compile({
    checkpointer: new PostgresSaver(pgPool),          // persistent state
    interruptBefore: ["execute_plan"],                 // always pause before creating tasks
  });
```

### 4.2 Analyze Signals Node

```typescript
async function analyzeSignalsNode(state: StrategicState) {
  const response = await llm.invoke([
    new SystemMessage(`You are Senior PM of "${state.brain.productName}".
    
    Product goal: ${state.brain.goal}
    Current phase: ${state.brain.phase}
    Known gaps: ${state.brain.knownGaps.join(", ")}
    
    Cluster the customer signals into themes.
    For each theme rate:
    - frequency (how many signals)
    - churn_risk: high/medium/low
    - revenue_impact: estimated ARR at risk
    - urgency: now/next/later`),
    
    new HumanMessage(JSON.stringify(state.rawSignals.slice(0, 200))),
  ]);
  
  // Returns structured themes array
  const themes: Theme[] = JSON.parse(extractJson(response.content));
  
  // Sort by churn_risk * frequency
  themes.sort((a, b) => score(b) - score(a));
  
  return { themes };
}
```

### 4.3 Research Market Node

```typescript
async function researchMarketNode(state: StrategicState) {
  const topThemes = state.themes.slice(0, 3);
  
  const results = await Promise.all(topThemes.map(async (theme) => {
    const [competitors, bestPractices, news] = await Promise.all([
      // Competitors làm gì
      tavilySearch(`${state.brain.competitors.join(" OR ")} ${theme.name} feature 2025`),
      // Best practices
      tavilySearch(`best practices ${theme.name} SaaS ${state.brain.techStack} 2025`),
      // Latest news
      tavilySearch(`${state.brain.domain} ${theme.name} news 2025`),
    ]);
    
    return { theme: theme.name, competitors, bestPractices, news };
  }));
  
  return { research: { themes: results } };
}
```

### 4.4 Plan Sprint Node

```typescript
async function planSprintNode(state: StrategicState) {
  const currentIssueStats = await getIssueStats(state.projectId);
  
  const response = await llm.invoke([
    new SystemMessage(`You are PM+CTO of "${state.brain.productName}".
    
    === PRODUCT CONTEXT ===
    Goal: ${state.brain.goal}
    Phase: ${state.brain.phase}
    Current sprint: ${JSON.stringify(state.brain.currentSprint)}
    Velocity: ${state.brain.velocity} tasks/sprint
    Known gaps: ${state.brain.knownGaps.join(", ")}
    
    === CURRENT HEALTH ===
    In progress: ${currentIssueStats.in_progress}
    Blocked: ${currentIssueStats.blocked}
    Done this sprint: ${currentIssueStats.done}
    
    === TOP CUSTOMER PAINS ===
    ${state.themes.slice(0, 3).map(t => 
      `- ${t.name}: ${t.count} signals, churn risk ${t.churnRisk}, ${t.revenueImpact}`
    ).join("\n")}
    
    === MARKET RESEARCH ===
    ${JSON.stringify(state.research)}
    
    Propose 1-3 tasks for next sprint.
    Each task must have:
    - title, description, acceptance_criteria[]
    - priority: P0/P1/P2
    - complexity: S(1d)/M(3d)/L(1w)
    - reasoning (why now, what customer pain it solves)
    - department: engineering/design/qa/devops/data_ml
    - competitor_reference (optional)`),
    
    new HumanMessage("What should we build next sprint?"),
  ]);
  
  const proposals: TaskProposal[] = JSON.parse(extractJson(response.content));

  // Sync #3: emit ProposedAction with confidence + Confirm pattern
  const confidence = computeConfidence(state, proposals);   // 0-1, agent self-conf
  const threshold = await effectiveThreshold('sprint_plan', state.workspaceId);

  return {
    proposals,
    proposed_action: {
      pattern: confidence >= threshold ? 'Confirm' : 'Edit',
      confidence,
      payload: {
        title: `Sprint plan: ${proposals.length} tasks (${state.brain.productName})`,
        diff_summary: proposals.map(p => `${p.priority} ${p.title} [${p.complexity}]`),
        cost_forecast: estimateSprintCost(proposals),
        rationale: state.themes[0]?.name,
        fallback_if_rejected: 'reduce_scope_to_top_2',
      },
    },
  };
}
```

→ When `confidence >= threshold` AND workspace passes progressive-trust gate ([[Autonomy-Dial-and-Progressive-Trust-Design]] §4), `humanApprovalNode` renders Confirm pattern (single OK click). Below threshold → Edit pattern (human tweaks proposals before approve).

### 4.5 Human Approval Node (interrupt)

```typescript
async function humanApprovalNode(state: StrategicState) {
  // interrupt() pauses the graph here
  // Paperclip UI shows a notification with proposals
  // User can approve all, approve some, or reject with feedback
  
  const userDecision = interrupt({
    type: "strategic_plan_approval",
    message: `Strategic Loop proposes ${state.proposals.length} tasks for next sprint:`,
    proposals: state.proposals,
    digest: state.weeklyDigest,
    context: {
      topPain: state.themes[0],
      competitorInsight: state.research.themes[0]?.competitors?.slice(0, 200),
    }
  });
  
  // After user responds, graph resumes
  return {
    approvedTasks: userDecision.approved,
    // user can edit proposals before approving
  };
}
```

### 4.6 Execute Plan Node

```typescript
async function executePlanNode(state: StrategicState) {
  // Create Paperclip issues from approved proposals
  const created = await Promise.all(
    state.approvedTasks.map(task => 
      createIssue({
        projectId: state.projectId,
        title: task.title,
        description: buildIssueBody(task),
        priority: task.priority,
        labels: [task.department, "strategic-loop"],
        // Assign to best available agent for this department
        assigneeAgentId: await findBestAgent(task.department, state.brain.companyId),
      })
    )
  );
  
  return { createdIssues: created };
}
```

---

## 5. Weekly Digest

Mỗi thứ Hai, Loop gửi digest tóm tắt tuần qua:

```
=== FCTCAI Weekly Product Digest — Week 18, 2026 ===

📊 METRICS THIS WEEK
  Tasks completed: 12 (+20% vs last week)
  Blocked issues: 3 (↓ from 8)
  Adapter failures: 2 (↓ from 18)
  
😤 TOP CUSTOMER PAINS (from 47 signals)
  1. "Agent bị stuck không biết tại sao" (12 tickets) — HIGH CHURN RISK
  2. "Muốn assign task cho specific agent" (8 tickets)
  3. "Hard to onboard" (31 reviews, avg 3★)

🔭 MARKET SIGNALS
  • Devin.ai shipped "project memory" → users love persistent context
  • LangGraph Cloud GA → checkpointing now trivial
  • 3 YC W25 startups doing "AI PM" → space heating up

🎯 PROPOSED FOR NEXT SPRINT
  [P0] Agent Observability Dashboard (M, 3d) — fixes 12 tickets
  [P1] Cost-per-feature breakdown (S, 1d) — prevents $ARR churn  
  [P2] Project Brain seed from README (M, 3d) — improves onboarding

👉 Review and approve: https://app.paperclip.ai/ATO/approvals
```

---

## 6. Tech Stack

| Layer | Technology | Role |
|-------|-----------|------|
| Orchestration | LangGraph (StateGraph) | Strategic Loop graph engine |
| Checkpointing | `@langchain/langgraph-checkpoint-postgres` | Persistent state, resume after interrupt |
| LLM | Claude Sonnet 4.6 | Analysis, planning, synthesis |
| Search | Tavily API | Market research, competitor analysis |
| Observability | LangSmith | Trace every decision, audit trail |
| Memory DB | PostgreSQL (project_brain) | Long-term product context |
| Signals DB | PostgreSQL (product_signals) | Customer feedback store |
| Notifications | Paperclip Inbox + Email | Human approval workflow |

---

## 7. Implementation Roadmap

### Phase 0 — Foundation (1-2 ngày)
- [ ] Tạo `project_brain` table
- [ ] Tạo `product_signals` table  
- [ ] Seed ATO project brain data
- [ ] Endpoint: `GET/POST /projects/:id/brain`

### Phase 1 — Context Injection (1 ngày)
- [ ] Wire PostgresSaver checkpointer vào existing LangGraph workflows
- [ ] Inject `project_brain` context vào agent payload
- [ ] Enable LangSmith tracing (`LANGCHAIN_TRACING_V2=true`)

### Phase 2 — Signal Collection (2-3 ngày)
- [ ] Manual signal input UI (paste feedback)
- [ ] Auto-parse: support tickets từ Paperclip issues
- [ ] Weekly analysis job (cron)

### Phase 3 — Strategic Loop MVP (3-5 ngày)
- [ ] `collect_signals` → `analyze_signals` → `plan_sprint` nodes
- [ ] `interrupt()` wired to Paperclip Approvals
- [ ] Weekly digest email/inbox message

### Phase 4 — Market Intelligence (ongoing)
- [ ] Tavily search integration
- [ ] Competitor monitoring
- [ ] arXiv/research paper tracking (for AI products)

### Phase 5 — Full Autonomy
- [ ] Loop chạy tự động mỗi tuần
- [ ] Self-adjusting velocity tracking
- [ ] A/B proposal testing (try task X, measure impact)

---

## 8. Điểm khác biệt vs Human PM

| Capability | Human PM | Strategic Loop |
|-----------|----------|---------------|
| Đọc tickets | 1x/tuần | Realtime |
| Nhớ context | Quên sau 3 tháng | Project Brain nhớ vĩnh viễn |
| Research | 2 ngày/sprint | 30 giây |
| Bias | Feature bias, recency bias | Pure data-driven |
| Availability | 8h/ngày, 5 ngày | 24/7 |
| Sprint planning | 2h meeting | 5 phút |
| **Human approval** | **Không cần** | **Luôn cần (interrupt)** |

> Human vẫn là decision-maker cuối cùng. Loop là intelligence layer, không phải replacement.

---

---

## 9. Internal Auditor Layer

> **Vấn đề**: Strategic Loop đề xuất và thực thi — nhưng không có ai độc lập kiểm tra xem hệ thống đang hoạt động đúng hướng không, proposals có chất lượng không, và outcomes có đúng với mục tiêu không.

Internal Auditor là một LangGraph graph chạy **độc lập, sau** Strategic Loop. Nó đóng vai trò **LLM-as-Judge** — không bị bias bởi context của Loop.

### 9.1 Kiến trúc Auditor

```
┌─────────────────────────────────────────────────────────┐
│                   INTERNAL AUDITOR                       │
│              (chạy sau mỗi sprint kết thúc)             │
│                                                          │
│  [collect_outcomes]                                      │
│       ↓                                                  │
│  [score_proposals]   ← "proposals tuần trước có đúng?"  │
│       ↓                                                  │
│  [score_agents]      ← "agent nào tốt/kém?"             │
│       ↓                                                  │
│  [detect_drift]      ← "loop đang đi đúng hướng goal?"  │
│       ↓                                                  │
│  [generate_report]   → Audit Report vào Obsidian         │
│       ↓                                                  │
│  [alert_if_critical] → notify human nếu có vấn đề nghiêm│
└─────────────────────────────────────────────────────────┘
```

### 9.2 Database Schema

```sql
-- Lưu kết quả audit mỗi sprint
CREATE TABLE audit_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id),
  sprint_name     TEXT NOT NULL,
  period_start    TIMESTAMPTZ,
  period_end      TIMESTAMPTZ,

  -- Scores (0-100)
  loop_quality_score   INT,    -- proposals có aligned với goal không?
  outcome_score        INT,    -- tasks done có fix được pain không?
  agent_perf_score     INT,    -- agents có deliver đúng SLA không?
  drift_score          INT,    -- 100 = on track, 0 = completely drifted

  -- Detail
  findings        JSONB DEFAULT '[]',   -- [{severity, finding, recommendation}]
  proposal_audit  JSONB DEFAULT '[]',   -- từng proposal: đề xuất gì, kết quả thực tế
  agent_scores    JSONB DEFAULT '{}',   -- {agentId: {sla_score, quality_score, velocity}}
  drift_analysis  TEXT,                 -- free text LLM analysis

  -- Actions
  critical_alerts JSONB DEFAULT '[]',   -- issues cần human attention ngay
  auto_fixes      JSONB DEFAULT '[]',   -- những gì auditor tự fix được

  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Lưu kết quả outcome của từng task (để auditor đánh giá)
CREATE TABLE task_outcomes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id        UUID NOT NULL REFERENCES issues(id),
  proposal_id     TEXT,                 -- link về proposal đã tạo task này

  stated_goal     TEXT,                 -- "fix adapter failures"
  stated_metric   TEXT,                 -- "reduce adapter_failed from 18 to <3"
  
  -- Measured after task done (T+7 days)
  actual_outcome  TEXT,                 -- "adapter failures dropped to 2"
  metric_before   FLOAT,
  metric_after    FLOAT,
  success         BOOLEAN,

  llm_verdict     TEXT,                 -- "SUCCESS / PARTIAL / FAILED"
  llm_reasoning   TEXT,

  measured_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### 9.3 Score Proposals Node

```typescript
async function scoreProposalsNode(state: AuditState) {
  // Lấy tất cả proposals từ sprint vừa xong + outcomes của chúng
  const proposals = await getSprintProposals(state.sprintName);
  const outcomes  = await getTaskOutcomes(proposals.map(p => p.issueId));

  const response = await auditorLLM.invoke([
    new SystemMessage(`You are an independent auditor. Evaluate the Strategic Loop's proposals.
    
    Product goal: ${state.brain.goal}
    Sprint goal:  ${state.sprintGoal}
    
    For each proposal, judge:
    1. Was it aligned with the product goal? (0-10)
    2. Was the stated reasoning sound? (0-10)
    3. Did the outcome match the stated goal? (0-10)
    4. Was there a better alternative that was missed?
    
    Be critical. Your job is to find where the Loop made poor decisions.`),

    new HumanMessage(JSON.stringify({ proposals, outcomes })),
  ]);

  const audit = JSON.parse(extractJson(response.content));
  return {
    proposalAudit: audit.proposals,
    loopQualityScore: audit.overall_score,
    findings: audit.findings,
  };
}
```

### 9.4 Detect Drift Node

```typescript
async function detectDriftNode(state: AuditState) {
  // Nhìn lại 4 sprints gần nhất
  const recentSprints = await getRecentAudits(state.projectId, 4);

  const response = await auditorLLM.invoke([
    new SystemMessage(`You are a strategic drift detector.
    
    Original product goal: ${state.brain.goal}
    Original vision: ${state.brain.vision}
    Current phase: ${state.brain.phase}
    
    Analyze the last 4 sprints' work. Signs of drift:
    - Tasks being created that don't relate to the core goal
    - Repeated same failures without learning
    - Velocity declining sprint over sprint
    - Proposals ignoring known_gaps in favor of new features
    - "Busy work" tasks with low impact
    
    Give a drift score (100 = perfectly on track, 0 = completely drifted).
    Identify specific drift patterns if any.`),

    new HumanMessage(JSON.stringify(recentSprints)),
  ]);

  const drift = JSON.parse(extractJson(response.content));
  return {
    driftScore: drift.score,
    driftAnalysis: drift.analysis,
    driftPatterns: drift.patterns,
  };
}
```

### 9.5 Score Agents Node

```typescript
async function scoreAgentsNode(state: AuditState) {
  const agentMetrics = await db.execute(sql`
    SELECT
      a.id, a.name, a.adapter_type,
      COUNT(i.id)                                          AS total_tasks,
      COUNT(CASE WHEN i.status = 'done' THEN 1 END)        AS completed,
      COUNT(CASE WHEN i.status = 'cancelled' THEN 1 END)   AS cancelled,
      AVG(EXTRACT(EPOCH FROM (i.updated_at - i.created_at))/3600)::int AS avg_hours,
      COUNT(CASE WHEN hr.status = 'failed' THEN 1 END)     AS failed_runs
    FROM agents a
    LEFT JOIN issues i ON i.assignee_agent_id = a.id
      AND i.created_at BETWEEN ${state.periodStart} AND ${state.periodEnd}
    LEFT JOIN heartbeat_runs hr ON hr.agent_id = a.id
      AND hr.finished_at BETWEEN ${state.periodStart} AND ${state.periodEnd}
    WHERE a.company_id = ${state.companyId}
    GROUP BY a.id, a.name, a.adapter_type
  `);

  // Compute SLA score: expected hours by complexity vs actual
  const scores = computeAgentScores(agentMetrics);
  return { agentScores: scores };
}
```

### 9.6 Alert nếu Critical

```typescript
async function alertIfCriticalNode(state: AuditState) {
  const criticalFindings = state.findings.filter(f => f.severity === "critical");

  if (state.driftScore < 40) {
    criticalFindings.push({
      severity: "critical",
      finding: `Drift score ${state.driftScore}/100 — system is significantly off-goal`,
      recommendation: "Review and rewrite project_brain goal + constraints immediately",
    });
  }

  if (state.loopQualityScore < 50) {
    criticalFindings.push({
      severity: "critical",
      finding: `Loop proposal quality ${state.loopQualityScore}/100 — proposals poorly aligned`,
      recommendation: "Review Strategic Loop system prompts and known_gaps list",
    });
  }

  if (criticalFindings.length > 0) {
    // Tạo issue với priority P0 trong Paperclip
    await createIssue({
      title: `[AUDITOR] ${criticalFindings.length} critical findings — sprint ${state.sprintName}`,
      description: formatCriticalFindings(criticalFindings),
      priority: "urgent",
      labels: ["auditor", "critical"],
    });

    // Gửi inbox notification
    await sendInboxAlert({
      title: "Internal Auditor — Critical Findings",
      body: criticalFindings[0].finding,
      link: `/audit-reports/${state.reportId}`,
    });
  }

  return { criticalAlerts: criticalFindings };
}
```

### 9.7 Audit Report Format

```
=== INTERNAL AUDIT — Sprint 5 — 2026-04-28 to 2026-05-05 ===

🎯 OVERALL SCORES
  Loop Quality:    72/100  (proposals reasonably aligned)
  Outcome Score:   85/100  (tasks mostly fixed stated pains)
  Agent Perf:      68/100  (agent-2 consistently slow)
  Drift Score:     91/100  (on track ✅)

📋 PROPOSAL AUDIT
  ✅ "Fix adapter fallback"     → failures 18→2  (SUCCESS, as predicted)
  ✅ "Unblock stale issues"     → blocked 8→0   (SUCCESS)
  ⚠️  "Add dark mode"           → 0 churn impact (LOW VALUE — not aligned with phase)
  ❌ "Refactor event bus"       → no user impact (BUSY WORK — avoid next sprint)

🤖 AGENT PERFORMANCE
  agent-engineering-1:  88/100  avg 2.1h/task  (excellent)
  agent-devops-1:       71/100  avg 4.3h/task  (acceptable)
  agent-qa-1:           45/100  avg 9.1h/task  ⚠️  (below SLA, investigate)

🔍 DRIFT ANALYSIS
  Score: 91/100 — system is on track.
  Minor concern: 2 of 8 tasks this sprint were "nice to have" features,
  not aligned with phase goal "core_agents_mvp".
  Recommendation: tighten Loop system prompt to filter cosmetic tasks.

⚡ FINDINGS
  [MEDIUM] Loop proposed dark mode (low churn impact) — add "phase filter" to planSprintNode
  [LOW]    agent-qa-1 consistently slow — consider reassigning QA tasks to engineering agent

👉 Full report: /ATO/audit-reports/sprint-5
```

---

## 10. Outcome Tracking

Sau khi task được mark `done`, Outcome Tracker chạy sau **T+7 ngày** để đo impact thực tế:

```typescript
// Cron job: mỗi ngày, tìm tasks done 7 ngày trước chưa có outcome
async function measureOutcomes() {
  const tasksToMeasure = await getTasksDoneNDaysAgo(7);

  for (const task of tasksToMeasure) {
    const metric = await extractMetricFromIssue(task);
    if (!metric) continue; // task không có stated metric → skip

    const before = metric.baseline;
    const after  = await measureCurrentMetric(metric.type, task.projectId);

    await db.insert(taskOutcomes).values({
      issueId: task.id,
      statedGoal:   metric.goal,
      statedMetric: metric.description,
      metricBefore: before,
      metricAfter:  after,
      success:      isImproved(before, after, metric.direction),
      measuredAt:   new Date(),
    });
  }
}
```

---

## 11. Budget / Cost Governance

```sql
CREATE TABLE llm_cost_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID REFERENCES projects(id),
  agent_id    UUID REFERENCES agents(id),
  issue_id    UUID REFERENCES issues(id),
  source      TEXT,   -- "strategic_loop" | "execution_agent" | "auditor"
  model       TEXT,
  input_tokens  INT,
  output_tokens INT,
  cost_usd    FLOAT,
  logged_at   TIMESTAMPTZ DEFAULT now()
);
```

Budget guard trong mỗi node:

```typescript
// Trước khi gọi LLM bất kỳ
const spentThisSprint = await getSprintCost(projectId);
if (spentThisSprint > brain.budgetUsd * 0.9) {
  // Alert, switch to cheaper model, hoặc skip non-critical nodes
  return interrupt({ type: "budget_warning", spent: spentThisSprint, limit: brain.budgetUsd });
}
```

### 11.1 Per-workspace cost forecast (autonomy-aware) — Gap A

```sql
CREATE TABLE workspace_cost_forecast (
  workspace_id            TEXT PRIMARY KEY,
  projected_weekly_p50    NUMERIC,
  projected_weekly_p90    NUMERIC,
  weekly_cap              NUMERIC,         -- from autonomy_profile.weekly_cost_cap
  computed_at             TIMESTAMPTZ DEFAULT now(),
  source                  TEXT             -- 'history_4w' | 'template'
);
```

Forecast (nightly cron 02:15):
```python
def forecast_workspace_weekly(workspace_id):
    history = mission_cost_events_last_4w(workspace_id)
    base_ema = ewma(history, halflife='14d')
    multiplier = {
        'sandbox': 1.5,    # high retry overhead
        'high':    1.0,
        'medium':  0.85,   # gates pause some spend
        'low':     0.75,
    }[workspace.autonomy_level]
    p50 = base_ema * multiplier
    p90 = p50 * 1.6        # log-normal tail
    return p50, p90
```

### 11.2 Autonomy-aware budget guard — Sync #5 + Gap A

```python
async def budget_guard(workspace_id, mission):
    profile = await get_autonomy_profile(workspace_id)   # from workspace.autonomy_profile JSONB
    forecast = await get_forecast(workspace_id)

    # Soft throttle: forecast breach → demote autonomy 1 step, weekly digest
    if forecast.p90 > profile.weekly_cost_cap:
        await demote_autonomy(workspace_id, reason='cost_forecast_breach')
        await emit_digest(workspace_id, 'cost_throttle', forecast)

    # Hard guard: actual spend hits 95% of cap
    spent = await get_sprint_cost(workspace_id)
    if spent > profile.weekly_cost_cap * 0.95:
        if breach_consecutive_weeks(workspace_id) >= 2:
            return interrupt({
                'type': 'cost_breach_critical',
                'pattern': 'Decide',                  # high-stakes → human decides
                'options': ['raise_cap', 'pause_workspace', 'reduce_scope'],
            })
```

→ Default budget guard (above) becomes fallback khi workspace chưa có `autonomy_profile`.

---

## 12. Emergency Circuit Breaker

```typescript
// Trong Strategic Loop — check trước mỗi node
async function circuitBreakerCheck(state: StrategicState): Promise<"continue" | "halt"> {
  const checks = await Promise.all([
    checkBudgetLimit(state.projectId),          // vượt budget?
    checkRecentProposalRejections(state),        // user reject liên tục?
    checkLoopDriftScore(state.projectId),        // drift score < 30?
    checkUnhandledCriticalAlerts(state.projectId), // có critical alerts chưa xử lý?
  ]);

  const shouldHalt = checks.some(c => c.halt);
  if (shouldHalt) {
    await sendInboxAlert({ title: "Strategic Loop halted", body: checks.find(c => c.halt)!.reason });
    return "halt";
  }
  return "continue";
}
```

---

## 13. Tech Stack (cập nhật)

| Layer | Technology | Role |
|-------|-----------|------|
| Orchestration | LangGraph (StateGraph) | Strategic Loop + Auditor graphs |
| Checkpointing | `@langchain/langgraph-checkpoint-postgres` | Persistent state, resume after interrupt |
| LLM — Planning | Claude Sonnet 4.6 | Analysis, planning, synthesis |
| LLM — Auditor | Claude Opus 4.7 | Independent judgment, higher quality |
| Search | Tavily API | Market research, competitor analysis |
| Observability | LangSmith | Trace every decision, audit trail |
| Memory DB | PostgreSQL (project_brain) | Long-term product context |
| Signals DB | PostgreSQL (product_signals) | Customer feedback store |
| Audit DB | PostgreSQL (audit_reports, task_outcomes) | Audit history |
| Cost DB | PostgreSQL (llm_cost_log) | Budget tracking |
| Notifications | Paperclip Inbox + Email | Human approval + critical alerts |

---

## 14. Implementation Roadmap (cập nhật)

### Phase 0 — Foundation (1-2 ngày)
- [ ] Tạo `project_brain`, `product_signals` tables
- [ ] Seed ATO project brain data
- [ ] Endpoint: `GET/POST /projects/:id/brain`

### Phase 1 — Context Injection (1 ngày)
- [ ] Wire PostgresSaver checkpointer
- [ ] Inject `project_brain` context vào agent payload
- [ ] Enable LangSmith tracing

### Phase 2 — Signal Collection (2-3 ngày)
- [ ] Manual signal input UI
- [ ] Auto-parse tickets từ Paperclip issues
- [ ] Weekly analysis cron job

### Phase 3 — Strategic Loop MVP (3-5 ngày)
- [ ] `collect_signals` → `analyze_signals` → `plan_sprint` nodes
- [ ] `interrupt()` wired to Paperclip Approvals
- [ ] Weekly digest
- [ ] Budget guard + circuit breaker

### Phase 4 — Internal Auditor (3-4 ngày)
- [ ] `audit_reports`, `task_outcomes`, `llm_cost_log` tables
- [ ] Auditor graph: score_proposals, detect_drift, score_agents
- [ ] Outcome tracker cron (T+7 days)
- [ ] Critical alert → inbox notification
- [ ] Audit report UI trong Paperclip

### Phase 5 — Market Intelligence (ongoing)
- [ ] Tavily search integration
- [ ] Competitor monitoring
- [ ] arXiv/research paper tracking

### Phase 6 — Full Autonomy
- [ ] Loop + Auditor chạy tự động
- [ ] Self-adjusting velocity + budget
- [ ] Cross-sprint retrospective auto-generation

---

## 15. Luồng hoàn chỉnh (Full System)

```
WEEKLY CYCLE:
                                          ┌─────────────┐
                                          │   AUDITOR   │
                                          │  (Sprint N) │
                                          └──────┬──────┘
                                                 │ findings
                                                 ▼
Customer Signals ──┐              ┌─────────────────────────┐
Market Research ───┤              │      PROJECT BRAIN       │
Audit Findings ────┼─────────────▶│  (goal, gaps, metrics,  │
Codebase State ────┘              │   audit history)         │
                                  └────────────┬────────────┘
                                               │
                                               ▼
                                  ┌─────────────────────────┐
                                  │     STRATEGIC LOOP      │
                                  │  (Sprint N+1 Planning)  │
                                  └────────────┬────────────┘
                                               │ interrupt()
                                               ▼
                                       Human Approval
                                               │
                                               ▼
                                  ┌─────────────────────────┐
                                  │    EXECUTION AGENTS     │
                                  │  (Engineering, QA, etc) │
                                  └────────────┬────────────┘
                                               │ task done
                                               ▼
                                  ┌─────────────────────────┐
                                  │    OUTCOME TRACKER      │
                                  │    (T+7 days measure)   │
                                  └────────────┬────────────┘
                                               │ outcomes
                                               ▼
                                  ┌─────────────────────────┐
                                  │      AUDITOR feeds      │
                                  │   back into next cycle  │
                                  └─────────────────────────┘
```

> **Key insight**: Auditor không chỉ review — nó **feed findings ngược lại vào Project Brain** để Loop học từ sai lầm. Đây là vòng lặp tự cải thiện thực sự.

---

---

## 17. Work Efficiency Review System

> **Vấn đề**: Hệ thống hiện tại không phân biệt được "task nhỏ nhưng tốn chi phí gấp 10x bình thường" với "task lớn nhưng agent làm hời hợt chỉ để done nhanh". Cần 1 layer riêng phát hiện, phân tích nguyên nhân, đề xuất cải tiến, và track trạng thái xử lý.

### 17.1 Hai Pattern Vấn Đề Chính

```
Pattern A — Over-spent (nhỏ mà tốn)          Pattern B — Shallow (lớn mà hời hợt)
─────────────────────────────────────         ──────────────────────────────────────
Task complexity: S (expected 1h, $0.05)       Task complexity: L (expected 3 days)
Actual cost:     $1.20 (24x over budget)      Actual duration: 2h
Actual time:     8h                           Output quality:  32/100

Signals:                                      Signals:
• tokens >> S-task baseline                   • quality_score < 50
• nhiều retry loops                           • acceptance_criteria không đủ
• agent bị confuse về scope                   • không có tests
• thiếu context khi bắt đầu                  • không mention edge cases
                                              • PR diff quá nhỏ so với scope
```

### 17.2 Database Schema

```sql
-- Mỗi task hoàn thành đều có 1 efficiency review
CREATE TABLE task_efficiency_reviews (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id         UUID NOT NULL REFERENCES issues(id),
  project_id       UUID NOT NULL REFERENCES projects(id),
  agent_id         UUID REFERENCES agents(id),

  -- Task profile (đo được)
  declared_complexity  TEXT,        -- 'S' | 'M' | 'L' — từ proposal gốc
  actual_duration_h    FLOAT,       -- giờ thực tế từ created → done
  actual_tokens        INT,         -- tổng tokens consumed (input + output)
  actual_cost_usd      FLOAT,       -- tổng cost thực tế
  retry_count          INT,         -- số lần retry
  failed_runs          INT,         -- số heartbeat_runs failed

  -- Baseline (expected cho complexity đó)
  baseline_duration_h  FLOAT,       -- S=2h, M=8h, L=24h
  baseline_cost_usd    FLOAT,       -- S=$0.05, M=$0.20, L=$0.80

  -- Efficiency scores (0-100, computed)
  cost_efficiency_score   INT,      -- 100 = đúng budget, <50 = over-spent nhiều
  quality_depth_score     INT,      -- 100 = thorough, <50 = hời hợt
  time_efficiency_score   INT,      -- 100 = đúng timeline

  -- Pattern detected
  pattern              TEXT,        -- 'over_spent' | 'shallow' | 'both' | 'ok' | 'excellent'
  severity             TEXT,        -- 'critical' | 'high' | 'medium' | 'low' | 'none'

  -- Root cause analysis (LLM generated)
  root_causes          JSONB DEFAULT '[]',
  -- Ví dụ: [
  --   { "cause": "missing_context", "confidence": 0.9, "evidence": "agent asked clarifying Qs 5 times" },
  --   { "cause": "wrong_model_tier", "confidence": 0.7, "evidence": "used Opus for simple CRUD task" }
  -- ]

  -- Improvement proposals (LLM generated)
  improvement_proposals JSONB DEFAULT '[]',
  -- Ví dụ: [
  --   { "id": "ip-1", "type": "add_context", "description": "Inject project_brain before task start",
  --     "estimated_saving": "60% cost reduction", "effort": "S" },
  --   { "id": "ip-2", "type": "change_model_tier", "description": "Route S-tasks to Haiku instead of Sonnet",
  --     "estimated_saving": "$0.80/sprint", "effort": "S" }
  -- ]

  -- Review state machine
  status               TEXT DEFAULT 'pending',
  -- pending → under_review → approved | rejected
  -- approved → implementing → fixed → verified

  reviewed_by          TEXT,        -- 'human' | 'auto' | 'auditor'
  reviewed_at          TIMESTAMPTZ,
  review_notes         TEXT,        -- human comment khi review

  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

-- Các improvement action đã được approve và đang track
CREATE TABLE efficiency_improvement_actions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id         UUID NOT NULL REFERENCES task_efficiency_reviews(id),
  project_id        UUID NOT NULL REFERENCES projects(id),

  proposal_id       TEXT NOT NULL,   -- ref về improvement_proposals[].id
  action_type       TEXT NOT NULL,
  -- 'refine_prompt'      — sửa system prompt của agent
  -- 'change_model_tier'  — đổi model cho task type này
  -- 'add_context'        — inject thêm context vào payload
  -- 'decompose_task'     — tách task lớn thành subtasks
  -- 'add_acceptance'     — thêm acceptance criteria mẫu
  -- 'change_agent'       — route task type này sang agent khác
  -- 'flow_change'        — sửa LangGraph flow/node
  -- 'process_change'     — sửa quy trình (vd: review gate trước execute)

  description       TEXT NOT NULL,
  estimated_saving  TEXT,
  effort            TEXT,           -- 'S' | 'M' | 'L'

  -- State
  status            TEXT DEFAULT 'pending_approval',
  -- pending_approval → approved | rejected → implementing → done → verified

  approved_by       TEXT,           -- who approved
  approved_at       TIMESTAMPTZ,
  rejection_reason  TEXT,

  -- Implementation tracking
  impl_issue_id     UUID REFERENCES issues(id),   -- Paperclip issue tạo để fix
  impl_notes        TEXT,
  impl_at           TIMESTAMPTZ,

  -- Verification (sau khi fix, chạy lại đo)
  verified_at       TIMESTAMPTZ,
  metric_before     FLOAT,
  metric_after      FLOAT,
  verified_success  BOOLEAN,

  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- Index để query nhanh
CREATE INDEX idx_efficiency_reviews_status    ON task_efficiency_reviews(status, project_id);
CREATE INDEX idx_efficiency_reviews_pattern   ON task_efficiency_reviews(pattern, severity);
CREATE INDEX idx_improvement_actions_status   ON efficiency_improvement_actions(status, project_id);
```

### 17.3 State Machine

```
task_efficiency_reviews.status:

  [pending]
      │  Auditor agent chạy xong analysis
      ▼
  [under_review]
      │  Human mở review UI
      ├──── approve ──────▶ [approved]
      │                         │ tự động tạo improvement_actions
      └──── reject ──────▶ [rejected] (đóng, không track nữa)
                               │ (với lý do — vd: "false positive")
                               
  [approved]
      │  improvement_actions được tạo
      ▼
  (xem improvement_actions state machine bên dưới)


efficiency_improvement_actions.status:

  [pending_approval]
      │
      ├── approve ──▶ [approved]
      │                   │ tạo Paperclip issue để implement
      │                   ▼
      │              [implementing]
      │                   │ issue marked done
      │                   ▼
      │              [done]
      │                   │ Outcome Tracker chạy lại sau T+14 ngày
      │                   ▼
      │              [verified] ✅ (hoặc [verification_failed] → loop lại)
      │
      └── reject ──▶ [rejected] (với lý do)
```

### 17.4 Efficiency Reviewer Agent (LangGraph Node)

Chạy tự động **ngay sau khi task được mark `done`**:

```typescript
async function runEfficiencyReview(issueId: string) {
  const issue   = await getIssueWithHistory(issueId);
  const runs    = await getHeartbeatRuns(issueId);
  const costLog = await getLLMCostLog(issueId);

  // 1. Compute raw metrics
  const actualDurationH = hoursElapsed(issue.createdAt, issue.doneAt);
  const actualCostUsd   = costLog.reduce((s, r) => s + r.costUsd, 0);
  const actualTokens    = costLog.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);
  const retryCount      = runs.filter(r => r.status === "failed").length;

  const baseline        = COMPLEXITY_BASELINE[issue.complexity ?? "M"];
  const costRatio       = actualCostUsd / baseline.costUsd;    // 1.0 = perfect
  const timeRatio       = actualDurationH / baseline.durationH;

  // 2. Compute efficiency scores
  const costEfficiencyScore = Math.max(0, Math.round(100 - (costRatio - 1) * 50));
  const timeEfficiencyScore = Math.max(0, Math.round(100 - (timeRatio - 1) * 30));

  // 3. Quality depth score — LLM judges the output
  const qualityScore = await judgeOutputQuality(issue);

  // 4. Detect pattern
  const pattern = detectPattern(costRatio, qualityScore, issue.complexity);

  // Skip if everything is fine
  if (pattern === "ok" || pattern === "excellent") {
    await saveReview({ issueId, pattern, severity: "none", status: "auto_closed" });
    return;
  }

  // 5. Root cause analysis — LLM
  const { rootCauses, proposals } = await analyzeRootCause({
    issue, runs, costLog, costRatio, timeRatio, qualityScore, pattern,
  });

  // 6. Save review (status = pending)
  await db.insert(taskEfficiencyReviews).values({
    issueId,
    declaredComplexity:   issue.complexity,
    actualDurationH,
    actualTokens,
    actualCostUsd,
    retryCount,
    baselineDurationH:    baseline.durationH,
    baselineCostUsd:      baseline.costUsd,
    costEfficiencyScore,
    qualityDepthScore:    qualityScore,
    timeEfficiencyScore,
    pattern,
    severity:             computeSeverity(costRatio, qualityScore),
    rootCauses,
    improvementProposals: proposals,
    status: "pending",
  });

  // 7. Alert nếu critical
  if (severity === "critical") {
    await sendInboxAlert({
      title: `[Efficiency] Critical issue on ${issue.identifier}`,
      body:  `${pattern === "over_spent" ? "Cost 10x over budget" : "Large task done superficially"}`,
      link:  `/efficiency-reviews/${review.id}`,
    });
  }
}
```

### 17.5 Root Cause Taxonomy

```typescript
const ROOT_CAUSE_TYPES = {
  // Cost quá cao (Pattern A)
  missing_context:       "Agent thiếu project context → hỏi lại nhiều lần, loop dài",
  wrong_model_tier:      "Dùng Opus/Sonnet cho task đơn giản, nên dùng Haiku",
  excessive_retries:     "Task fail nhiều lần trước khi succeed → cost nhân lên",
  scope_creep:           "Task được giao nhỏ nhưng agent tự mở rộng scope",
  poor_decomposition:    "Task lớn không được tách → agent xử lý monolith, inefficient",
  ambiguous_spec:        "Acceptance criteria mơ hồ → agent đoán, làm lại nhiều lần",
  tool_call_loop:        "Agent gọi tool lặp lại không cần thiết (bug trong flow)",

  // Chất lượng thấp (Pattern B)
  no_acceptance_criteria: "Task không có AC rõ ràng → agent làm vừa đủ để 'pass'",
  missing_tests:          "Agent không viết tests dù task yêu cầu",
  shallow_implementation: "Agent implement happy path, bỏ qua edge cases",
  context_not_read:       "Agent không đọc related code trước khi implement",
  premature_done:         "Agent mark done quá sớm, output chưa đủ",
  no_review_gate:         "Không có QA/review step trước khi done",
};
```

### 17.6 LLM Judge: Output Quality

```typescript
async function judgeOutputQuality(issue: Issue): Promise<number> {
  const response = await auditorLLM.invoke([
    new SystemMessage(`You are a senior engineer reviewing a completed task.
    
    Score the output quality from 0-100:
    - 90-100: Thorough, tested, handles edge cases, well-documented
    - 70-89:  Complete and working, minor gaps
    - 50-69:  Works for happy path, missing edge cases or tests
    - 30-49:  Shallow implementation, significant gaps
    - 0-29:   Barely done, major requirements missed
    
    Check for:
    ✓ All acceptance criteria met?
    ✓ Tests written (if applicable)?
    ✓ Edge cases handled?
    ✓ No obvious security issues?
    ✓ Output consistent with task complexity (${issue.complexity})?`),

    new HumanMessage(JSON.stringify({
      title:       issue.title,
      description: issue.description,
      complexity:  issue.complexity,
      pr_diff:     issue.prDiff,         // nếu có
      comments:    issue.activityLog,    // agent's work log
    })),
  ]);

  return parseInt(extractScore(response.content));
}
```

### 17.7 Improvement Proposal Generation

```typescript
async function analyzeRootCause(context: ReviewContext) {
  const response = await auditorLLM.invoke([
    new SystemMessage(`You are an efficiency consultant for an AI agent system.
    
    A task has completed with poor efficiency. Analyze root causes and propose fixes.
    
    Pattern: ${context.pattern}
    Cost ratio: ${context.costRatio}x over baseline (baseline: $${context.baseline.costUsd})
    Quality score: ${context.qualityScore}/100
    Retry count: ${context.retryCount}
    
    Available fix types:
    - refine_prompt: update agent system prompt
    - change_model_tier: use cheaper model for this task type
    - add_context: inject project_brain or codebase context before task
    - decompose_task: split into smaller subtasks automatically
    - add_acceptance: generate acceptance criteria template for this task type
    - change_agent: route this task type to a different agent
    - flow_change: modify the LangGraph node flow
    - process_change: add a review gate before marking done
    
    For each proposal include:
    - estimated_saving (cost % or quality improvement)
    - effort (S/M/L to implement)
    - specific actionable description`),

    new HumanMessage(JSON.stringify({
      issue:   context.issue,
      runs:    context.runs.slice(0, 10),
      costLog: context.costLog,
    })),
  ]);

  return JSON.parse(extractJson(response.content));
}
```

### 17.8 Review UI trong Paperclip

```
┌─────────────────────────────────────────────────────────┐
│  EFFICIENCY REVIEW — ATO-512 "Add dark mode toggle"     │
│  Status: pending  │  Pattern: OVER_SPENT  │  🔴 HIGH    │
├─────────────────────────────────────────────────────────┤
│  METRICS                                                 │
│  Complexity declared: S   Expected: 2h / $0.05          │
│  Actual duration:    11h  ▲ 5.5x                        │
│  Actual cost:       $0.62  ▲ 12.4x  ← flag              │
│  Retry count:         7   ▲ (normal: 0-1)               │
│  Quality score:      71/100  ✓ (adequate)               │
├─────────────────────────────────────────────────────────┤
│  ROOT CAUSES (LLM analysis)                             │
│  🔴 missing_context (conf: 0.91)                        │
│     "Agent asked 'where is the theme config?' 4 times.  │
│      Project brain has no codebase map entry."          │
│  🟠 ambiguous_spec (conf: 0.74)                         │
│     "No AC specified which components need dark mode."  │
├─────────────────────────────────────────────────────────┤
│  IMPROVEMENT PROPOSALS                                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │ [ip-1] add_context               effort: S  ✅  │   │
│  │ Inject codebase_map into agent payload          │   │
│  │ Estimated saving: ~70% cost reduction           │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ [ip-2] add_acceptance            effort: S  ✅  │   │
│  │ Auto-generate AC template for UI tasks          │   │
│  │ Estimated saving: reduces ambiguity retry loops │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  [Approve Selected]  [Reject All — False Positive]      │
└─────────────────────────────────────────────────────────┘
```

### 17.9 Complexity Baselines

```typescript
const COMPLEXITY_BASELINE = {
  S: { durationH: 2,  costUsd: 0.05, qualityMin: 70 },
  M: { durationH: 8,  costUsd: 0.20, qualityMin: 75 },
  L: { durationH: 24, costUsd: 0.80, qualityMin: 80 },
};

function detectPattern(costRatio: number, qualityScore: number, complexity: string): Pattern {
  const isOverSpent = costRatio > 3.0;                                    // >3x baseline cost
  const isShallow   = qualityScore < COMPLEXITY_BASELINE[complexity].qualityMin - 20;

  if (isOverSpent && isShallow) return "both";
  if (isOverSpent)              return "over_spent";
  if (isShallow)                return "shallow";
  if (costRatio < 0.5 && qualityScore > 85) return "excellent";
  return "ok";
}

function computeSeverity(costRatio: number, qualityScore: number): Severity {
  if (costRatio > 10 || qualityScore < 30) return "critical";
  if (costRatio > 5  || qualityScore < 50) return "high";
  if (costRatio > 3  || qualityScore < 60) return "medium";
  return "low";
}
```

### 17.10 Aggregate Insights

Auditor dùng dữ liệu từ bảng này để tìm **pattern hệ thống**, không chỉ từng task:

```sql
-- Top nguyên nhân gây lãng phí trong sprint
SELECT
  rc->>'cause'                    AS root_cause,
  COUNT(*)                        AS occurrences,
  SUM(actual_cost_usd - baseline_cost_usd)::numeric(10,2) AS total_waste_usd,
  AVG(cost_efficiency_score)::int AS avg_efficiency
FROM task_efficiency_reviews,
     jsonb_array_elements(root_causes) AS rc
WHERE project_id = :projectId
  AND created_at > now() - interval '14 days'
  AND pattern IN ('over_spent', 'both')
GROUP BY rc->>'cause'
ORDER BY total_waste_usd DESC;

-- Kết quả ví dụ:
-- missing_context   | 8 tasks | $3.20 wasted | avg efficiency 31/100
-- ambiguous_spec    | 5 tasks | $1.80 wasted | avg efficiency 44/100
-- wrong_model_tier  | 3 tasks | $0.90 wasted | avg efficiency 55/100
```

Loop dùng kết quả này để tự cải thiện system prompt và routing rules.

### 17.11 Integration với Strategic Loop

Sau mỗi sprint, Auditor tổng hợp efficiency reviews và **feed vào Project Brain**:

```typescript
// Trong updateBrainNode của Auditor
const topWasteCauses = await getTopWasteCauses(projectId, "14d");
const shallowPatterns = await getShallowPatterns(projectId, "14d");

await db.update(projectBrain).set({
  known_gaps: [
    ...brain.known_gaps,
    // Tự động thêm vào known_gaps nếu chưa có
    ...topWasteCauses
      .filter(c => c.total_waste_usd > 1.0)
      .map(c => `efficiency: ${c.root_cause} causing $${c.total_waste_usd} waste/sprint`),
  ],
  updated_at: new Date(),
});
```

Từ sprint tiếp theo, Strategic Loop **biết và tránh** các patterns này khi planning.

---

---

## 18. Knowledge Base Layer — Multi-Repo & Technical Documentation

> **Vấn đề**: Paperclip hiện chỉ có generic markdown docs gắn với issues. Không có multi-repo registry, không có API specs, không có data/sequence/integration flow, không có doc context injection vào agents. Một dự án lớn cần tất cả những thứ này làm tài nguyên để lên task, đánh giá impact, và detect gaps.

### 18.1 Hiện trạng vs Nhu cầu

```
HIỆN TẠI (Paperclip)              CẦN CÓ
─────────────────────             ────────────────────────────────
documents (issue-scoped)          → Tech docs (project-scoped, typed)
project_workspaces.repoUrl        → Multi-repo registry per project
(single repo only)                → Cross-repo dependency graph
No API spec storage               → API Spec Registry (OpenAPI, versioned)
No doc context in agents          → Doc context injection into agent payload
No impact analysis                → Change Impact Analyzer
No doc coverage check             → Documentation Coverage Audit
```

### 18.2 Database Schema

```sql
-- ═══════════════════════════════════════════════
-- 1. REPOSITORY REGISTRY
-- ═══════════════════════════════════════════════
CREATE TABLE project_repos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id),
  company_id    UUID NOT NULL REFERENCES companies(id),

  name          TEXT NOT NULL,         -- "payment-service", "frontend", "mobile-app"
  repo_url      TEXT NOT NULL,         -- "https://github.com/org/payment-service"
  repo_type     TEXT NOT NULL,
  -- 'backend_service' | 'frontend' | 'mobile' | 'library' | 'infrastructure'
  -- 'data_pipeline' | 'ml_model' | 'api_gateway' | 'monorepo'

  primary_language  TEXT,             -- "TypeScript", "Python", "Go"
  tech_stack        JSONB DEFAULT '[]', -- ["Express", "PostgreSQL", "Redis"]
  team_owner        TEXT,             -- "engineering" | "platform" | "data_ml"

  -- Codebase snapshot (auto-updated by scanner)
  last_scanned_at   TIMESTAMPTZ,
  file_count        INT,
  test_coverage     FLOAT,
  has_openapi_spec  BOOLEAN DEFAULT false,
  exposed_ports     JSONB DEFAULT '[]',  -- [{"port": 3000, "protocol": "http"}]
  env_vars_required JSONB DEFAULT '[]',  -- documented required env vars

  description   TEXT,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════
-- 2. CROSS-REPO DEPENDENCY GRAPH
-- ═══════════════════════════════════════════════
CREATE TABLE repo_dependencies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id),

  from_repo_id    UUID NOT NULL REFERENCES project_repos(id),  -- caller
  to_repo_id      UUID NOT NULL REFERENCES project_repos(id),  -- callee

  dependency_type TEXT NOT NULL,
  -- 'http_api'        — calls REST API
  -- 'grpc'            — calls gRPC service
  -- 'event_consumer'  — subscribes to events/queue
  -- 'event_producer'  — publishes events
  -- 'shared_db'       — shares same database
  -- 'npm_package'     — imports as library
  -- 'file_share'      — reads/writes shared filesystem

  -- API details (if http_api or grpc)
  api_endpoints   JSONB DEFAULT '[]',
  -- [{ "method": "POST", "path": "/api/payments", "critical": true }]

  -- Event details (if event_consumer/producer)
  event_topics    JSONB DEFAULT '[]',
  -- [{ "topic": "order.created", "schema_version": "2.1" }]

  is_critical     BOOLEAN DEFAULT false,  -- breaking this = incident
  notes           TEXT,
  discovered_by   TEXT DEFAULT 'manual',  -- 'manual' | 'auto_scan' | 'import'
  created_at      TIMESTAMPTZ DEFAULT now(),

  UNIQUE(from_repo_id, to_repo_id, dependency_type)
);

-- ═══════════════════════════════════════════════
-- 3. TECHNICAL DOCUMENTATION STORE
-- ═══════════════════════════════════════════════
CREATE TABLE tech_docs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id),
  company_id    UUID NOT NULL REFERENCES companies(id),

  title         TEXT NOT NULL,
  doc_type      TEXT NOT NULL,
  -- ── Flow diagrams ──────────────────────────
  -- 'sequence_flow'    — request/response sequence between services
  -- 'data_flow'        — how data moves through system
  -- 'activity_flow'    — business process steps
  -- 'integration_flow' — external system integrations
  -- 'event_flow'       — async event/message flow
  -- ── Architecture ───────────────────────────
  -- 'system_architecture' — high-level system overview
  -- 'component_diagram'   — internal components of a service
  -- 'deployment_diagram'  — infra and deployment topology
  -- 'erd'                 — entity relationship diagram
  -- ── API ────────────────────────────────────
  -- 'api_spec'         — OpenAPI/Swagger spec
  -- 'api_flow'         — how a feature uses multiple APIs in sequence
  -- 'api_changelog'    — breaking/non-breaking API changes
  -- ── Design docs ────────────────────────────
  -- 'adr'              — Architecture Decision Record
  -- 'rfc'              — Request For Comment
  -- 'tech_spec'        — detailed technical specification
  -- 'runbook'          — operational runbook
  -- 'onboarding'       — developer onboarding guide
  -- 'gap_analysis'     — identified gaps in current system

  -- Content
  format        TEXT NOT NULL DEFAULT 'markdown',
  -- 'markdown' | 'mermaid' | 'plantuml' | 'openapi_yaml' | 'openapi_json' | 'drawio'
  body          TEXT NOT NULL,          -- raw content
  rendered_url  TEXT,                   -- cached render URL (for diagrams)

  -- Scope
  scope         TEXT NOT NULL DEFAULT 'project',
  -- 'project' | 'repo' | 'feature' | 'api_endpoint' | 'integration'
  repo_ids      JSONB DEFAULT '[]',     -- which repos this doc covers
  feature_tags  JSONB DEFAULT '[]',     -- ["checkout", "payment", "auth"]
  api_paths     JSONB DEFAULT '[]',     -- ["/api/payments", "/api/orders"]

  -- Freshness tracking
  version       TEXT DEFAULT '1.0.0',
  last_verified_at  TIMESTAMPTZ,
  staleness_score   FLOAT DEFAULT 0,    -- 0 = fresh, 1 = likely stale
  auto_stale_after  INTERVAL DEFAULT '90 days',

  -- Metadata
  author        TEXT,
  status        TEXT DEFAULT 'active',
  -- 'draft' | 'active' | 'deprecated' | 'needs_review'

  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Full-text + vector search
CREATE INDEX idx_tech_docs_type    ON tech_docs(doc_type, project_id);
CREATE INDEX idx_tech_docs_tags    ON tech_docs USING gin(feature_tags);
CREATE INDEX idx_tech_docs_api     ON tech_docs USING gin(api_paths);

-- ═══════════════════════════════════════════════
-- 4. API SPEC REGISTRY
-- ═══════════════════════════════════════════════
CREATE TABLE api_specs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id         UUID NOT NULL REFERENCES project_repos(id),
  project_id      UUID NOT NULL REFERENCES projects(id),

  service_name    TEXT NOT NULL,        -- "payment-service"
  base_url        TEXT,                 -- "https://api.example.com/v2"
  spec_format     TEXT DEFAULT 'openapi_3', -- 'openapi_3' | 'openapi_2' | 'graphql' | 'grpc_proto'
  spec_content    TEXT NOT NULL,        -- raw OpenAPI YAML/JSON

  version         TEXT NOT NULL,        -- "2.3.1"
  prev_version_id UUID REFERENCES api_specs(id),

  -- Change analysis (computed on upload)
  breaking_changes   JSONB DEFAULT '[]',
  -- [{ "path": "/payments", "method": "POST", "change": "removed required field 'currency'" }]
  non_breaking_changes JSONB DEFAULT '[]',
  new_endpoints      JSONB DEFAULT '[]',
  deprecated_endpoints JSONB DEFAULT '[]',

  -- Consumer tracking — which repos call this API?
  known_consumers JSONB DEFAULT '[]',   -- [{ "repo_id": "...", "repo_name": "frontend" }]

  -- Health
  is_current      BOOLEAN DEFAULT true,
  sync_status     TEXT DEFAULT 'manual',  -- 'manual' | 'auto_synced' | 'import'
  last_synced_at  TIMESTAMPTZ,

  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════
-- 5. DOC COVERAGE TRACKING
-- ═══════════════════════════════════════════════
CREATE TABLE doc_coverage_gaps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id),

  gap_type      TEXT NOT NULL,
  -- 'undocumented_api'       — endpoint exists in code but no spec
  -- 'missing_sequence_flow'  — feature exists but no sequence diagram
  -- 'stale_doc'              — doc not updated in X days while code changed
  -- 'missing_erd'            — has DB tables but no ERD
  -- 'missing_integration_doc'— has external integration but no doc
  -- 'missing_runbook'        — service has no runbook
  -- 'missing_adr'            — architectural decision made without ADR
  -- 'broken_dep_link'        — dependency in graph but no doc covering it

  description   TEXT NOT NULL,
  affected_repo TEXT,
  affected_path TEXT,           -- specific file/endpoint/feature

  severity      TEXT DEFAULT 'medium',  -- 'critical' | 'high' | 'medium' | 'low'
  auto_detected BOOLEAN DEFAULT true,

  -- Resolution
  status        TEXT DEFAULT 'open',    -- 'open' | 'in_progress' | 'resolved' | 'wont_fix'
  resolution_issue_id UUID REFERENCES issues(id),  -- Paperclip issue created to fix

  detected_at   TIMESTAMPTZ DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);
```

### 18.3 Doc Context Injection vào Agent

Hiện tại agent nhận task với chỉ `title + description`. Cần inject thêm:

```typescript
// Trong assignNode của LangGraph workflow
async function buildAgentContext(issue: Issue): Promise<AgentContext> {
  const brain     = await getProjectBrain(issue.projectId);
  const repos     = await getRelevantRepos(issue);       // repos liên quan đến task
  const docs      = await getRelevantDocs(issue);        // docs matching feature_tags
  const apiSpecs  = await getRelevantApiSpecs(issue);    // API specs cho endpoints liên quan
  const depGraph  = await getDepGraph(repos.map(r => r.id)); // services liên quan

  return {
    // Hiện tại (đã có)
    issueId:     issue.id,
    title:       issue.title,
    description: issue.description,

    // Thêm mới — Project Brain
    projectGoal:  brain.goal,
    projectPhase: brain.phase,
    constraints:  brain.constraints,

    // Thêm mới — Repos
    affectedRepos: repos.map(r => ({
      name:     r.name,
      repoUrl:  r.repoUrl,
      techStack: r.techStack,
      owner:    r.teamOwner,
    })),

    // Thêm mới — Relevant Docs
    relevantDocs: docs.map(d => ({
      title:   d.title,
      type:    d.docType,
      summary: d.body.slice(0, 500),  // first 500 chars as summary
      fullUrl: `/docs/${d.id}`,        // agent can fetch full doc if needed
    })),

    // Thêm mới — API Context
    apiSpecs: apiSpecs.map(s => ({
      service:   s.serviceName,
      version:   s.version,
      endpoints: extractRelevantEndpoints(s.specContent, issue.title),
    })),

    // Thêm mới — Dependency map
    dependencies: depGraph.map(d => ({
      from:   d.fromRepoName,
      to:     d.toRepoName,
      type:   d.dependencyType,
      topics: d.eventTopics,
    })),
  };
}
```

### 18.4 Change Impact Analyzer

Khi có bug/change request/issue mới, tự động phân tích impact:

```typescript
// Chạy khi issue được tạo (classify node trong LangGraph)
async function analyzeChangeImpact(issue: Issue): Promise<ImpactAnalysis> {
  const response = await llm.invoke([
    new SystemMessage(`You are a senior architect. Given this issue, identify:
    1. Which repos are likely affected?
    2. Which API endpoints might change?
    3. Which sequence/integration flows are involved?
    4. Which downstream consumers might break?
    5. What tests need to run?
    
    Available repos: ${JSON.stringify(allRepos)}
    Dependency graph: ${JSON.stringify(depGraph)}
    Available docs: ${JSON.stringify(docIndex)}  // titles + tags only, not full content
    `),
    new HumanMessage(`Issue: ${issue.title}\n\n${issue.description}`),
  ]);

  const impact = JSON.parse(extractJson(response.content));

  // Gắn vào issue
  await db.update(issues).set({
    impactAnalysis: impact,  // JSONB field
  }).where(eq(issues.id, issue.id));

  // Nếu critical: alert
  if (impact.affectedRepos.length > 3 || impact.breakingApiChange) {
    await sendInboxAlert({
      title: `High impact change: ${issue.identifier}`,
      body:  `Affects ${impact.affectedRepos.length} repos, ${impact.affectedEndpoints.length} API endpoints`,
    });
  }

  return impact;
}
```

**Output ví dụ:**
```json
{
  "affectedRepos": ["payment-service", "order-service", "frontend"],
  "affectedEndpoints": ["POST /api/payments", "GET /api/orders/:id"],
  "affectedFlows": ["checkout-sequence-flow", "payment-integration-flow"],
  "breakingApiChange": false,
  "downstreamConsumers": ["frontend", "mobile-app"],
  "suggestedTests": [
    "integration: payment + order service",
    "e2e: checkout flow",
    "contract: payment API consumer"
  ],
  "estimatedScope": "M",
  "crossRepoPRsRequired": ["payment-service", "frontend"]
}
```

### 18.5 Documentation Coverage Auditor

Chạy weekly, tự động phát hiện gaps:

```typescript
async function runDocCoverageAudit(projectId: string) {
  const repos    = await getProjectRepos(projectId);
  const allDocs  = await getTechDocs(projectId);
  const apiSpecs = await getApiSpecs(projectId);
  const gaps: DocCoverageGap[] = [];

  for (const repo of repos) {
    // 1. Không có API spec
    if (repo.hasExposedEndpoints && !apiSpecs.find(s => s.repoId === repo.id)) {
      gaps.push({ gapType: "undocumented_api", affectedRepo: repo.name, severity: "high" });
    }

    // 2. Không có sequence flow cho features chính
    const repoFeatures = extractFeaturesFromIssues(repo.id);
    for (const feature of repoFeatures) {
      const hasSeqDoc = allDocs.some(d =>
        d.docType === "sequence_flow" && d.featureTags.includes(feature)
      );
      if (!hasSeqDoc) {
        gaps.push({ gapType: "missing_sequence_flow", affectedRepo: repo.name,
                    description: `Feature "${feature}" has no sequence diagram`, severity: "medium" });
      }
    }

    // 3. Không có runbook cho production services
    if (repo.repoType === "backend_service") {
      const hasRunbook = allDocs.some(d => d.docType === "runbook" && d.repoIds.includes(repo.id));
      if (!hasRunbook) {
        gaps.push({ gapType: "missing_runbook", affectedRepo: repo.name, severity: "medium" });
      }
    }
  }

  // 4. Stale docs — không cập nhật trong 90+ ngày
  const staleDocs = allDocs.filter(d => {
    const daysSince = daysBetween(d.lastVerifiedAt, new Date());
    return daysSince > 90;
  });
  for (const doc of staleDocs) {
    gaps.push({ gapType: "stale_doc", description: `"${doc.title}" not verified in 90+ days`,
                severity: "low" });
  }

  // Persist gaps
  await db.insert(docCoverageGaps).values(gaps);

  // Feed vào Project Brain
  if (gaps.filter(g => g.severity === "high" || g.severity === "critical").length > 0) {
    await appendToKnownGaps(projectId, `doc_gaps: ${gaps.length} documentation gaps found`);
  }
}
```

### 18.6 Staleness Detection

Tự động flag docs cũ khi code thay đổi:

```typescript
// Webhook từ GitHub/GitLab — khi PR merged
async function onPrMerged(pr: PullRequest) {
  const changedFiles = pr.changedFiles;  // ["src/payments/controller.ts", ...]

  // Tìm docs có thể bị stale
  const affectedDocs = await db.select().from(techDocs)
    .where(and(
      eq(techDocs.projectId, pr.projectId),
      // docs có api_paths hoặc feature_tags match với PR
      sql`api_paths ?| ${extractApiPaths(changedFiles)}
       OR feature_tags ?| ${extractFeatureTags(changedFiles)}`
    ));

  for (const doc of affectedDocs) {
    // Tăng staleness score
    const newScore = Math.min(1.0, doc.stalenessScore + 0.3);
    await db.update(techDocs)
      .set({ stalenessScore: newScore, status: newScore > 0.7 ? "needs_review" : doc.status })
      .where(eq(techDocs.id, doc.id));

    if (newScore > 0.7) {
      // Tạo gap entry
      await db.insert(docCoverageGaps).values({
        projectId: pr.projectId,
        gapType: "stale_doc",
        description: `"${doc.title}" may be outdated — PR ${pr.number} changed related code`,
        severity: "medium",
        affectedRepo: pr.repoName,
      });
    }
  }
}
```

### 18.7 Strategic Loop Integration

Loop dùng Knowledge Base để lên task thông minh hơn:

```typescript
// Trong planSprintNode — bổ sung doc context
async function planSprintNode(state: StrategicState) {
  const docGaps    = await getOpenDocGaps(state.projectId);      // từ doc_coverage_gaps
  const staleDocs  = await getStaleDocs(state.projectId);         // từ tech_docs
  const missingSpecs = await getMissingApiSpecs(state.projectId); // repos không có spec

  const response = await llm.invoke([
    new SystemMessage(`...existing context...
    
    === DOCUMENTATION STATE ===
    Open doc gaps: ${docGaps.length} (${docGaps.filter(g=>g.severity==="high").length} high)
    Stale docs: ${staleDocs.length}
    Services missing API spec: ${missingSpecs.map(r=>r.name).join(", ")}
    
    When proposing tasks, consider:
    - High-severity doc gaps block new features (agents can't understand the system)
    - Missing API specs mean integration changes are risky
    - Stale sequence flows lead to agents implementing wrong behavior`),
    new HumanMessage("What should we build next sprint?"),
  ]);
}
```

### 18.8 Kiến trúc Tổng thể (Updated)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PAPERCLIP PLATFORM                           │
│                                                                       │
│  ┌──────────────────┐     ┌───────────────────────────────────────┐ │
│  │  PROJECT BRAIN   │────▶│           STRATEGIC LOOP              │ │
│  │  + KNOWLEDGE BASE│     │                                       │ │
│  │                  │◀────│  signals → analyze → research → plan  │ │
│  │ • goal, phase    │     └──────────────────┬────────────────────┘ │
│  │ • project_repos  │                        │                       │
│  │ • tech_docs      │     ┌──────────────────▼────────────────────┐ │
│  │ • api_specs      │     │        CHANGE IMPACT ANALYZER         │ │
│  │ • dep_graph      │     │  (classify node — runs on new issues) │ │
│  │ • doc_gaps       │     └──────────────────┬────────────────────┘ │
│  └──────────────────┘                        │ enriched context       │
│                                              ▼                       │
│                              ┌───────────────────────────────────┐  │
│                              │         EXECUTION AGENTS          │  │
│                              │  (receive full doc context)       │  │
│                              │                                   │  │
│                              │  • project_brain                  │  │
│                              │  • affected repos + tech stack    │  │
│                              │  • relevant sequence/API flows    │  │
│                              │  • API specs for endpoints        │  │
│                              │  • dependency map                 │  │
│                              └───────────────────────────────────┘  │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    AUDITOR LAYER                                 │ │
│  │  Internal Auditor │ Efficiency Reviewer │ Doc Coverage Auditor  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 18.9 Implementation Roadmap (bổ sung vào Phase 0)

#### Phase 0b — Knowledge Base Foundation (2-3 ngày, song song Phase 0)
- [ ] Tạo `project_repos`, `repo_dependencies`, `tech_docs`, `api_specs`, `doc_coverage_gaps` tables
- [ ] Seed: đăng ký repos của ATO project
- [ ] Seed: nhập các docs hiện có (ADRs, sequence flows) vào `tech_docs`
- [ ] UI: Repo Registry page trong Project settings
- [ ] UI: Tech Docs browser tab (trong ProjectDetail)

#### Phase 1b — Doc Context Injection (1-2 ngày)
- [ ] `buildAgentContext()` — inject relevant docs + API specs vào agent payload
- [ ] Change Impact Analyzer trong classify node
- [ ] Endpoint: `GET /projects/:id/impact-analysis?issueId=...`

#### Phase 3b — Doc Coverage Auditor (2 ngày)
- [ ] Weekly cron: `runDocCoverageAudit()`
- [ ] Staleness detection via GitHub webhook
- [ ] Doc gaps → Strategic Loop integration
- [ ] UI: Documentation Coverage dashboard

---

## 16. Liên kết

- [[Paperclip-Platform-Workspace-Mission-Model]] — 3-layer Platform/Workspace/Mission model
- [[ADR-0002-Pure-LangGraph]] — quyết định không dùng Temporal
