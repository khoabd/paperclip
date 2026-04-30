---
tags: [architecture, autonomy, greenfield, bootstrap, design]
date: 2026-04-29
priority: P0
---

# Greenfield Bootstrap Design

> **Mục đích:** Khi human chỉ có 1 ý tưởng ("tôi muốn làm SaaS quản lý fitness"), Paperclip tự động kick-off project — research thị trường, đề xuất stack, scaffold repo, sinh sprint đầu — chỉ cần human approve các milestone.

---

## 1. Vấn đề

KB Bootstrap (Knowledge-Base-Management-Strategy §3) chỉ cover **brownfield**: dự án đã có codebase. Nhưng nhiều dự án bắt đầu từ:

| Input level | Description | Tỉ lệ ước tính |
|-------------|-------------|----------------|
| L0 — Idea only | "Tôi muốn làm app gym tracker" | 40% |
| L1 — Idea + audience | "...cho người đi gym 3-5 lần/tuần, 25-40 tuổi" | 30% |
| L2 — Idea + mockups | Có Figma sketch nhưng chưa có code | 20% |
| L3 — Requirements doc | PRD đầy đủ nhưng chưa có code | 10% |

**Hiện tại:** Strategic Loop assume `project_brain` đã được seed → Phase 0 nói "human seed brain bằng tay". Vi phạm goal "human chỉ là gate".

**Cần:** Pipeline tự động từ L0/L1/L2/L3 → `project_brain` đầy đủ + repo scaffolded + sprint 1 ready.

> **Scope boundary — Greenfield vs Human Intake:**
> - **Greenfield (this doc)** = pipeline khi tạo **NEW project/workspace** (idea → brain → scaffold → sprint 1). Trigger: `greenfield_intake_submitted` (UI Wizard → Bootstrap orchestrator).
> - **Human Intake** ([[Human-Intake-and-Solution-Loop-Design]]) = inbound items vào **in-flight project đã có** (problem / feature_request / bug_report / feedback / strategic_input / question). Trigger: `intake.created` → Strategic Loop signal collector + per-type workflow.
> - Hai luồng song song, không overlap: Greenfield = "project chưa tồn tại"; Human Intake = "project có rồi, gửi yêu cầu vào project đó".

---

## 2. Greenfield Bootstrap Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                  GREENFIELD INTAKE                              │
│   Human: form đơn giản (idea + audience + ngân sách)            │
└─────────────────┬───────────────────────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 1: Idea Refinement (LLM)                                  │
│ Input: raw text     Output: structured product hypothesis        │
│ Gate: 🚦 Human approve product hypothesis                       │
└─────────────────┬───────────────────────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 2: Market Research (Tavily + arXiv + GitHub)              │
│ - Top 10 competitors (feature matrix)                           │
│ - Market size estimate (LLM + web)                              │
│ - Tech trend signals                                            │
│ Output: market_brief.md  (no gate, feeds next stage)            │
└─────────────────┬───────────────────────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 3: User Persona Generation (LLM-simulated)                │
│ - 3-5 personas with goals/pains/jobs                            │
│ - Top 20 user stories ranked                                    │
│ Gate: 🚦 Human approve personas + top 5 stories                │
└─────────────────┬───────────────────────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 4: Tech Stack Recommendation                              │
│ - Frontend / Backend / DB / Infra suggestions                   │
│ - Each with rationale + cost estimate + alternative             │
│ - Reuse org's prior stacks (from KB) when possible              │
│ Gate: 🚦 Human approve stack (or pick alternative)             │
└─────────────────┬───────────────────────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 5: Project Brain Generation                               │
│ - Goals, phase=mvp, target metrics, principles, decisions       │
│ - Auto-generated from Stages 1-4 outputs                        │
│ Gate: 🚦 Human edit/approve final brain                        │
└─────────────────┬───────────────────────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 6: Repo Scaffolding                                       │
│ - Create GitLab repo (via MCP)                                  │
│ - Apply template (cookiecutter or org-internal)                 │
│ - Initial CI/CD pipeline                                        │
│ - README auto-generated from brain                              │
│ Gate: optional — auto-approve if scaffold passes lint+build    │
└─────────────────┬───────────────────────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 7: Sprint 1 Generation                                    │
│ - Top 5 user stories → tasks                                    │
│ - Estimated effort + agent assignment                           │
│ - First Strategic Loop run                                      │
│ Gate: 🚦 Human approve Sprint 1 plan                           │
└─────────────────────────────────────────────────────────────────┘
```

**Total:** ~4-8h compute (mostly Tavily + LLM research) + 4 human gates (~30 min total human time).

---

## 3. Stage Detail Specs

### 3.1 Stage 1 — Idea Refinement

LLM extracts structured fields from raw input:

```typescript
interface ProductHypothesis {
  problem_statement: string;     // "Người đi gym khó track progress qua nhiều thiết bị"
  target_audience: string;        // "Gym-goers, 25-40, urban"
  proposed_solution: string;      // "Mobile app sync với smartwatch + AI form check"
  key_value_prop: string;
  monetization_model: string;     // freemium / subscription / one-time
  initial_scope: 'mvp' | 'prototype' | 'beta';
  estimated_budget_usd: number;
  estimated_timeline_weeks: number;
  uncertainty_areas: string[];    // "competitor density unknown"
  success_definition: string;
}
```

**Human gate:** UI shows hypothesis card, editable fields, then approve.

### 3.2 Stage 2 — Market Research

Parallel tool calls:
- `tavily.search("fitness tracker app competitors 2026")`
- `tavily.search("gym tracker market size revenue trends")`
- `github.trending(language=swift, topic=fitness)`
- `arxiv.search("computer vision exercise form detection")`

Aggregator synthesizes into `market_brief.md`:

```
# Market Brief: Fitness Tracker SaaS
## Top 10 Competitors (feature matrix)
| Name | Users | Pricing | Key feature gap |
| ... |

## Market size: $4.5B 2025 → $8B 2030 (12% CAGR)
## Tech opportunities: form-correction CV is emerging niche
## Risk: market saturated, need clear differentiation
## Recommended differentiators
```

No gate — feeds Stage 3.

### 3.3 Stage 3 — User Persona Generation

LLM generates personas using market brief + hypothesis:

```yaml
personas:
  - name: "Casual Casey"
    age_range: "28-35"
    goals: ["track gym 3x/week", "stay motivated"]
    pains: ["forgets to log", "doesn't know if making progress"]
    tech_savvy: medium
    willingness_to_pay: $5-10/mo

top_user_stories:
  - id: us-1
    persona: "Casual Casey"
    story: "As a casual gym-goer, I want auto-logged workouts so I don't break flow."
    priority: high
    effort_estimate: 2 weeks
```

**Human gate:** approve personas + pick top 5 stories from top 20.

> **GATE COLLAPSE — per [[Autonomy-Dial-and-Progressive-Trust-Design]] §12.3:** Doc gốc define 4 gates riêng (personas / stories / stack / brain) = ~25 min và 4 interrupts. Phải refactor thành **1 bundled review** (~2-5 min, 1 interrupt): agent compile full intake bundle với personas auto-ranked + stories auto-ranked + stack recommendation + brain initial; pattern = Confirm bundle, OR per-section adjust. Áp dụng khi implement Greenfield Sprint.

> **Test fixture source:** Personas approve ở stage này được lưu vào `project_brain.active_personas` và **reused làm test fixture** cho QA dept — xem [[Testing-and-Quality-Assessment-Capability]] §11 (Synthetic user persona simulation: agent simulate persona habits/goals/pain points để generate E2E scenario realistic, dùng cho Hercules + Appium suite). Một persona = một slice coverage. Persona update sau Greenfield → trigger regeneration TC kit cho QA.

### 3.4 Stage 4 — Tech Stack Recommendation

Recommendation engine considers:
- Hypothesis (mobile-first → React Native / Swift)
- Org KB (other org projects use Postgres → prefer Postgres)
- Budget (low → managed services > self-hosted)
- Team size (small → simpler stack)
- Recent industry trends (from Stage 2)

```yaml
recommended_stack:
  frontend:
    primary: "React Native + Expo"
    rationale: "Cross-platform, fast iteration, team already knows React"
    alternative: "Swift native"
    cost_per_month_dev: $0 (Expo free tier)
  backend:
    primary: "Node.js + tRPC + Postgres"
    rationale: "Org default, KB has 4 prior projects on this stack"
    alternative: "Python + FastAPI"
  ai_layer:
    primary: "OpenAI GPT-4o for form analysis (vision)"
    cost_estimate: "$0.02 * 10k req/mo = $200/mo"
  infra:
    primary: "Vercel + Railway + Neon"
    cost_estimate: "~$80/mo at MVP scale"
```

**Human gate:** approve stack or override sections.

### 3.5 Stage 5 — Project Brain Generation

Auto-fills `project_brain` schema:

```yaml
project_brain:
  product_goal: "...derived from hypothesis..."
  current_phase: "mvp_design"
  target_metrics:
    - {name: "activation_rate", target: 0.4, current: null}
    - {name: "weekly_retention_w1", target: 0.6, current: null}
  principles:
    - "Mobile-first always"
    - "Form analysis must work offline-first"
    - "Privacy: never store video frames after analysis"
  decisions:
    - {date: today, decision: "Use React Native", rationale: "..."}
  active_personas: [casey, ...]
  risk_register:
    - "Market saturation"
    - "CV model accuracy may not meet user expectations"
```

**Human gate:** review + edit brain before locking.

### 3.6 Stage 6 — Repo Scaffolding

Via GitLab MCP:
1. Create repo `org/fitness-tracker`
2. Apply template (org has cookiecutter-rn-trpc)
3. Configure CI/CD (`.gitlab-ci.yml` from template)
4. Generate README from brain
5. Push initial commit
6. Run `lint + build` to verify scaffold

If scaffold passes lint+build → auto-approve. If fails → escalate with build log.

### 3.7 Stage 7 — Sprint 1 Generation

Strategic Loop's `plan_sprint` node runs with:
- input: top 5 user stories from Stage 3
- brain: just created in Stage 5
- velocity: org default for greenfield (60% of brownfield until calibrated)

Output: 5 tasks with estimates + agent assignments.

**Human gate:** standard sprint approval (already in Strategic Loop).

### 3.8 Failure recovery state machine — Gap D

Per-stage retry policy + fallback:

| Stage | Failure type | Action |
|---|---|---|
| 1 (refine) | LLM error / output schema invalid | silent retry ×3 → gate `intake_failed_at_refine` (Choose: skip / retry / abandon) |
| 2 (market) | Tavily/arXiv API down | silent retry ×3 with backoff → fallback to LLM-only with flag `market_research_thin=true` |
| 3 (persona) | LLM produces < 3 personas | retry ×2 with stricter prompt → gate `intake_failed_at_persona` |
| 4 (stack) | No matching template / contradictory constraints | fallback to default template (FastAPI + Postgres + React) + flag `stack_review_pending=true` |
| 5 (brain) | Schema validation fail / pgvector index error | rollback artefacts of stages 1-4 (giữ raw intake doc) → gate `intake_failed_at_brain` for human fix |
| 6 (scaffold) | Repo create / push fail | retry ×2 với reduced complexity (drop optional features) → gate `scaffold_failed` |
| 7 (sprint 1) | plan_sprint exception | workspace state set `intake_failed`, recovery UI shows last successful artifact |

Schema:
```sql
CREATE TABLE intake_recovery_actions (
  intake_id     UUID REFERENCES greenfield_intakes(id),
  failed_stage  INT,
  action        TEXT,             -- 'retry' | 'fallback' | 'skip' | 'abandon' | 'human_fix'
  decided_by    TEXT,             -- 'auto' | user_email
  decided_at    TIMESTAMPTZ DEFAULT now(),
  notes         TEXT
);
```

**Pipeline degradation guard:** nếu 3 intake fail cùng `failed_stage` trong 30d → auto-pause Greenfield orchestrator + tạo critical approval item "Greenfield pipeline degraded at stage X" (Decide pattern).

---

## 4. Database Schema

```sql
CREATE TABLE greenfield_intakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by TEXT NOT NULL,
  raw_idea TEXT NOT NULL,
  initial_level TEXT NOT NULL,    -- L0, L1, L2, L3
  attached_files TEXT[],           -- Figma links, PRDs
  budget_usd NUMERIC,
  timeline_weeks INT,
  current_stage INT NOT NULL DEFAULT 1,
  current_status TEXT NOT NULL,    -- in_progress, awaiting_human, completed, abandoned
  hypothesis JSONB,
  market_brief_md TEXT,
  personas JSONB,
  user_stories JSONB,
  recommended_stack JSONB,
  generated_brain_id UUID,
  scaffolded_repo_url TEXT,
  sprint_1_id UUID,
  total_cost_usd NUMERIC(10,2),
  total_elapsed_minutes INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE bootstrap_progress (
  id BIGSERIAL PRIMARY KEY,
  intake_id UUID REFERENCES greenfield_intakes(id),
  stage INT NOT NULL,
  stage_name TEXT NOT NULL,
  status TEXT NOT NULL,            -- queued, running, awaiting_gate, completed, failed
  output_jsonb JSONB,
  approval_id UUID,                -- links to approval_items if gate
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cost_usd NUMERIC(10,4)
);
```

---

## 5. UX Flow

### 5.1 Intake Form

```
[New Project] → Intake Wizard
┌──────────────────────────────────────┐
│ What do you want to build?           │
│ [textarea — 1-3 sentences]            │
│                                       │
│ Who's it for? (optional)              │
│ [textarea]                            │
│                                       │
│ Attachments? (optional)               │
│ [drag-drop: Figma, PDF, images]      │
│                                       │
│ Budget cap?  [$_____ /month]         │
│ Timeline?    [____ weeks]            │
│                                       │
│ [Submit → Paperclip will research]   │
└──────────────────────────────────────┘
```

### 5.2 Bootstrap Progress Dashboard

```
🚀 Bootstrap: Fitness Tracker SaaS
Stage 3 of 7 ─ User Personas (running)
Elapsed: 2h 14m | Cost: $3.42 / budget $50

Stage 1 ✅ Idea Refinement (12 min, $0.18) [View]
Stage 2 ✅ Market Research (47 min, $1.20) [View market_brief.md]
Stage 3 🔵 Generating personas... [tail logs]
Stage 4 ⏳ Stack Recommendation (queued)
Stage 5 ⏳ Project Brain (queued)
Stage 6 ⏳ Repo Scaffolding (queued)
Stage 7 ⏳ Sprint 1 (queued)

⏸ [Pause]  🛑 [Cancel & refund]
```

### 5.3 Gate Approval Card

Standard approval card with extra "preview output" button to inspect generated artifacts before approving.

---

## 6. Cost Model

| Stage | Avg cost | Avg time |
|-------|---------|----------|
| 1 — Refinement | $0.20 | 5 min |
| 2 — Market Research | $1.50 | 45 min |
| 3 — Personas | $0.80 | 15 min |
| 4 — Stack | $0.40 | 10 min |
| 5 — Brain | $0.30 | 5 min |
| 6 — Scaffold | $0.10 | 5 min |
| 7 — Sprint 1 | $0.50 | 10 min |
| **Total** | **~$3.80** | **~1.5h compute + human gates** |

Default budget cap: $20/intake. Hard ceiling: $50.

---

## 7. Variants & Edge Cases

### 7.1 Brownfield handoff
If user submits L3 (full PRD) **and** existing repo URL → run greenfield Stages 1-5, then jump to KB §3 brownfield bootstrap for the repo, skipping Stages 6-7.

### 7.2 Idea kill switch
Each gate can reject. If 3 gates rejected total → mark intake `abandoned`, refund unused budget.

### 7.3 Resume from gate
If human takes >24h on a gate → intake auto-paused. Human can resume by re-opening approval card. State preserved.

### 7.4 Stack override mid-flight
If human rejects Stage 4 stack and picks alternative → re-run Stage 5 (Brain) with new stack info.

---

## 8. Implementation Roadmap

### Phase 0 — Schema + Intake (2 days)
- [ ] `greenfield_intakes`, `bootstrap_progress` tables
- [ ] Intake form UI
- [ ] Submit endpoint

### Phase 1 — Stage 1-3 (Discovery) (4 days)
- [ ] Idea refinement node
- [ ] Market research orchestrator (Tavily + arXiv + GitHub)
- [ ] Persona generator
- [ ] Approval gates wiring

### Phase 2 — Stage 4-5 (Decision) (3 days)
- [ ] Stack recommender (with KB lookup of org's prior stacks)
- [ ] Project Brain generator + auto-populate

### Phase 3 — Stage 6-7 (Execution) (3 days)
- [ ] GitLab MCP scaffolding flow
- [ ] Cookiecutter template integration
- [ ] Strategic Loop hookup for Sprint 1

### Phase 4 — UX Polish (2 days)
- [ ] Bootstrap progress dashboard
- [ ] Output preview modals
- [ ] Cancel/refund flow

---

## 9. Liên kết

- [[Autonomous-PM-Strategic-Loop-Design#2. Project Brain]] — receives generated brain
- [[Knowledge-Base-Management-Strategy#3. Cold Start]] — handoff for brownfield variant
- [[Development-Flow-and-Release-Strategy#7. Full Workflow]] — Sprint 1 enters this flow
- [[External-Integrations-and-Environment-Strategy#4. GitLab MCP]] — scaffolding via MCP
- [[UX-Strategy-and-Design#3. Information Architecture]] — Intake wizard placement
