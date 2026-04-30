# Phase 8 — Greenfield Bootstrap

**Status:** done (Apr 29) — MVP GATE
**Owner:** Khoa
**Depends on:** Phase 3 (ApprovalRouter), Phase 4 (BrainStore, IntakeMissionBridge), Phase 2 (CostAttributor)
**Anchors:** [[../Greenfield-Bootstrap-Design]] · [[../Implementation-Master-Plan#Phase 8]]

## Goal

Idea-to-project pipeline (7 stages, 4 gates). Takes a raw idea title + text, runs through market research, persona generation, stack recommendation, brain seeding, repo scaffolding, and Sprint 1 spawning — all with dependency-injected stage runners (mocked in tests, real MCPs in production). This is the **MVP GATE** milestone.

## Non-goals (deferred)

- HTTP routes (POST /api/greenfield, etc.) — Phase 15.
- UI Bootstrap Progress Dashboard — Phase 15.
- Real LLM calls in stage runners — wired in production deployment, stubbed in tests.
- Real GitLab MCP calls in `repoScaffold` runner — mocked in tests per critical rule 4.
- Real Tavily/arXiv calls in `marketResearch` runner — mocked in tests.
- Pipeline degradation guard (3 failures at same stage in 30d) — Phase 9+.
- Bundled gate review (GATE COLLAPSE per Autonomy-Dial §12.3) — Phase 9+ UX.

## §8.1 Schema additions

Numbering follows Phase 7 (last migration `0115_canary_runs`).

### `0116_greenfield_intakes.sql`

```
greenfield_intakes
 - id uuid pk default gen_random_uuid()
 - company_id uuid not null fk companies (cascade)
 - idea_title text not null
 - idea_text text not null
 - submitter_user_id text
 - status text not null default 'pending'   -- pending|running|gate_pending|done|aborted
 - total_cost_usd numeric(10,4)
 - wall_clock_ms bigint
 - started_at timestamptz
 - finished_at timestamptz
 - created_at timestamptz default now() not null
 - index (company_id, status, created_at)
```

### `0117_greenfield_stages.sql`

```
greenfield_stages
 - id uuid pk
 - intake_id uuid not null fk greenfield_intakes (cascade)
 - stage_name text not null          -- idea_refinement|market_research|personas|stack|brain|repo_scaffold|sprint1
 - sequence integer not null
 - status text not null default 'pending'  -- pending|running|done|failed|gated
 - inputs jsonb not null default '{}'
 - outputs jsonb not null default '{}'
 - gate_approval_id uuid fk approvals (set null)
 - started_at timestamptz
 - finished_at timestamptz
 - error text
 - unique (intake_id, sequence)
 - index (intake_id, status)
```

### `0118_intake_recovery_actions.sql`

```
intake_recovery_actions
 - id uuid pk
 - stage_id uuid not null fk greenfield_stages (cascade)
 - kind text not null                -- retry|alt_path|skip|abort
 - attempt_number integer not null default 1
 - action jsonb not null default '{}'
 - result text
 - occurred_at timestamptz default now() not null
 - index (stage_id, occurred_at)
```

### Document keys (ADR-0007, via BrainStore)

| Document key | Content |
|---|---|
| `persona/<slug>` | Persona markdown (one row per persona) |
| `market_research/<intakeId>` | Market brief markdown |
| `stack/<intakeId>` | Tech stack JSON as markdown |
| `brain/greenfield/<intakeId>` | Greenfield project brain seed |

## §8.2 Services

`server/src/greenfield/`

```
greenfield-state-machine.ts   pure canTransitionStage/Intake/Recovery + STAGE_SEQUENCE
greenfield-orchestrator.ts    GreenfieldOrchestrator.tick(intakeId) with injected StageRunners
greenfield-recovery.ts        GreenfieldRecovery.apply(stageId, kind)
greenfield-stage-seeder.ts    GreenfieldStageSeeder.seed(intakeId) — creates 7 stage rows
index.ts                      barrel re-export (no HTTP routes)
__tests__/
  greenfield-state-machine.test.ts
  greenfield-orchestrator.integration.test.ts
```

BrainStore extended with:
- `setPersonaDoc(workspaceId, slug, body)`
- `setMarketResearch(workspaceId, intakeId, body)`
- `setStackDoc(workspaceId, intakeId, body)`
- `setGreenfieldBrain(workspaceId, intakeId, body)`
- `upsertDoc(workspaceId, key, title, body, changeSummary)` (private helper)

## §8.3 Stages

| Seq | Stage | Status flow | Gate |
|---|---|---|---|
| 0 | `idea_refinement` | pending→running→done | Optional (choose pattern) |
| 1 | `market_research` | pending→running→done | None (auto) |
| 2 | `personas` | pending→running→done/gated | Choose: approve personas |
| 3 | `stack` | pending→running→done/gated | Choose: approve stack |
| 4 | `brain` | pending→running→done/gated | Edit: review brain |
| 5 | `repo_scaffold` | pending→running→done | None (auto if lint passes) |
| 6 | `sprint1` | pending→running→done | Standard sprint approval |

### Stage runner interface (dependency-injected)

```typescript
interface StageRunners {
  ideaRefinement(ctx): Promise<Record<string, unknown>>;
  marketResearch(ctx): Promise<{ notes: string }>;
  personas(ctx): Promise<{ personas: PersonaDoc[] }>;
  stack(ctx): Promise<{ stackJson: string }>;
  brain(ctx): Promise<{ brainBody: string }>;
  repoScaffold(ctx): Promise<{ repoUrl: string; defaultBranch: string }>;
  sprint1(ctx): Promise<{ missionId: string }>;
}
```

### Recovery flow

From any `failed` stage:
- `retry` → stage back to `pending` (re-runs on next tick)
- `alt_path` → stage back to `pending` (alternative runner variant)
- `skip` → stage `done` with `{ skipped: true, note: "..." }`
- `abort` → intake `status='aborted'`, `finished_at` set

### Cost + clock telemetry

- `CostAttributor.record()` called per stage with `model_call_id = greenfield:<intakeId>:<stage>:1`
- `total_cost_usd` summed via `CostAttributor.sumCostForCompanyBetween()` at finalisation
- `wall_clock_ms` = `finished_at - started_at` on intake row

## §8.4 Tests

| Test | Layer | What it proves |
|---|---|---|
| `greenfield-state-machine.test.ts` | unit | 63 cases: every legal + illegal stage/intake/recovery edge, terminal helpers, STAGE_SEQUENCE shape |
| `greenfield-orchestrator.integration.test.ts` | integration | 4 cases: happy path (7 stages done, intake done, cost>0, persona doc, brain doc, mission), retry recovery, gated-stage (approval pending → gate_pending → resolve → resume), abort recovery (intake=aborted) |

**Total: 67 new tests. Full suite: 260/260 green.**

## §8.5 Gate criteria (all ✅)

- [x] Migrations `0116`–`0118` applied; journal updated (idx 116/117/118); 3 Drizzle schemas exported from `packages/db/src/schema/index.ts`.
- [x] Pure state-machine tests cover every legal + illegal transition (63 tests ≥ 1 per edge).
- [x] Integration test: seeds intake, mocks per-stage runners, ticks until `sprint1.done` → 7 `greenfield_stages` rows all `done`, intake `status='done'`, `total_cost_usd > 0`, `wall_clock_ms >= 0`, ≥1 `persona/...` doc, `brain/greenfield/<id>` doc, `missions` row with goal containing idea title.
- [x] Recovery test: force `market_research` to `failed` → apply `retry` → `done` on next tick.
- [x] Gated-stage test: stage opens approval → `intake.status='gate_pending'`; resolve approval → next tick resumes `personas` stage to `done`.
- [x] All prior suites still green: `npx vitest run src/dev-flow/ src/platform/ src/intake/ src/greenfield/` → 260/260.
- [x] `Phases/Phase-8-Greenfield-Bootstrap.md` created (this file, status `done (Apr 29)`, MVP-Gate annotation).
- [x] `_index.md` updated: Phase 8 closed + `=== MVP GATE ===` marker + Phase 9 next.

## §8.6 Implementation notes (post-build)

- `GreenfieldOrchestrator.tick()` is a single-step driver — each call advances exactly one stage. Callers loop until `intakeStatus` is terminal. This is intentional: it keeps the tick idempotent and makes recovery easy (just call `GreenfieldRecovery.apply()` then tick again).
- The gate mechanism: the stage runner itself (or the ApprovalRouter in production) writes `status='gated'` + `gateApprovalId` to the stage row directly. On the next tick, the orchestrator sees `stage.status === 'gated'` and checks the approval. If not approved yet, it flips intake to `gate_pending` and returns. If approved, it resets stage to `pending` and re-ticks (recursive within the same call).
- `STAGE_SEQUENCE` is the single source of truth for stage names and order — both the seeder and the state machine use it.
- BrainStore `upsertDoc()` is a private helper that backs all 4 new greenfield-specific methods (`setPersonaDoc`, `setMarketResearch`, `setStackDoc`, `setGreenfieldBrain`). It follows the same pattern as the existing `getOrCreate` + `appendSection` but does full-body replacement (not append) — appropriate for initial generation artifacts.
- Cost telemetry uses stub values per stage (`STAGE_COST_USD` map in orchestrator). In production, the real runner injects actual token counts into the context and calls `CostAttributor.record()` with precise values.
- `GreenfieldRecovery.abort()` cascades directly to `greenfield_intakes.status='aborted'` without touching sibling stages — the intake is dead and the orchestrator will skip it on any future tick.
- The `GreenfieldStageSeeder` is a separate class (not part of orchestrator) so it can be called from the HTTP endpoint (Phase 15) at intake creation time, independent of the tick loop.

## §8.7 Files touched

- `packages/db/src/migrations/0116_greenfield_intakes.sql`
- `packages/db/src/migrations/0117_greenfield_stages.sql`
- `packages/db/src/migrations/0118_intake_recovery_actions.sql`
- `packages/db/src/migrations/meta/_journal.json` — 3 entries appended (idx 116–118)
- `packages/db/src/schema/greenfield_intakes.ts` (new)
- `packages/db/src/schema/greenfield_stages.ts` (new)
- `packages/db/src/schema/intake_recovery_actions.ts` (new)
- `packages/db/src/schema/index.ts` — 3 re-exports appended after `canaryRuns`
- `server/src/platform/strategic-loop/brain-store.ts` — 4 new public methods + private `upsertDoc`
- `server/src/greenfield/greenfield-state-machine.ts` (new)
- `server/src/greenfield/greenfield-orchestrator.ts` (new)
- `server/src/greenfield/greenfield-recovery.ts` (new)
- `server/src/greenfield/greenfield-stage-seeder.ts` (new)
- `server/src/greenfield/index.ts` (new)
- `server/src/greenfield/__tests__/greenfield-state-machine.test.ts` (new)
- `server/src/greenfield/__tests__/greenfield-orchestrator.integration.test.ts` (new)
- `obsidian/fctcai/01-Architecture/Phases/Phase-8-Greenfield-Bootstrap.md` (this file)
- `obsidian/fctcai/01-Architecture/_index.md` — Phase 8 closed + MVP GATE marker + Phase 9 next
