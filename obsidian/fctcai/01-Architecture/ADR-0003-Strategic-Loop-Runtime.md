# ADR-0003: Strategic Loop Runtime — TypeScript State Machine over LangGraph

**Status**: Accepted
**Date**: 2026-04-29
**Supersedes (in TS context)**: ADR-0002

## Context

The Autonomous PM Strategic Loop (`Autonomous-PM-Strategic-Loop-Design`) requires a graph-shaped controller: signal collection → triage → planning → routing → audit → loop. ADR-0002 chose LangGraph for the legacy Python FCTCAI codebase. We have since migrated to the **paperclip TypeScript monorepo** (Drizzle / Node / React). LangGraph's first-class runtime is Python; the JS port (`@langchain/langgraph`) is alpha-quality, lags Python, and pulls heavy LangChain JS deps.

Candidates evaluated:
- `@langchain/langgraph` (JS port)
- XState (battle-tested TS state machines)
- Inngest / Temporal-TS (durable workflow engines)
- Custom TS state machine + Drizzle persistence

## Decision

**Custom TypeScript state machine** persisted via Drizzle. Each strategic-loop step is a pure async function `(ctx, state) → nextState`. Transitions stored in a new `strategic_loop_runs` + `strategic_loop_events` table pair. Resume = re-hydrate state from DB, dispatch the next step.

The runtime is a single ~300-line module under `packages/shared/src/strategic-loop/` exposing `runStep()`, `resume()`, `cancel()`. Steps register themselves declaratively (`registerStep('triage', triageFn, { next: ['plan', 'reject'] })`).

## Rationale

- **Native to paperclip stack**: Drizzle persistence, Node/TS, no new infra.
- **Resume already solved**: paperclip has heartbeat + agent_runtime_state primitives; we reuse them instead of importing a workflow engine's checkpointer.
- **Determinism + testability**: pure-function steps are trivial to unit test with seeded state; LangGraph nodes are harder to isolate from the LLM client.
- **No vendor lock**: switching to Inngest/Temporal later is a refactor of one module, not a rewrite of every dept.
- **Cost**: zero new dependencies, ~1 week to implement vs. weeks debugging LangGraph-JS edge cases.

## Consequences

- ✅ All Strategic Loop, Greenfield, and Human-Intake flows use one consistent runtime.
- ✅ Loop state is queryable as plain SQL (no proprietary checkpoint format).
- ✅ Replay = `SELECT events WHERE run_id = ? ORDER BY seq` then re-fold.
- ⚠️ We own the runtime; bugs are ours to fix (mitigation: tests + property-based fuzz on the transition table).
- ⚠️ No native graph viz; we emit Mermaid from the registered step table on demand.
- ⚠️ At >10k concurrent loops, revisit Inngest/Temporal-TS.

## Schema sketch

```ts
export const strategicLoopRuns = pgTable("strategic_loop_runs", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  kind: text("kind").notNull(), // 'pm_strategic' | 'greenfield' | 'intake'
  state: jsonb("state").notNull(),
  status: text("status").notNull(), // 'running' | 'paused' | 'done' | 'failed'
  currentStep: text("current_step").notNull(),
  startedAt: timestamp("started_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const strategicLoopEvents = pgTable("strategic_loop_events", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull(),
  seq: integer("seq").notNull(),
  step: text("step").notNull(),
  input: jsonb("input"),
  output: jsonb("output"),
  durationMs: integer("duration_ms"),
  occurredAt: timestamp("occurred_at").notNull(),
});
```

## Migration note

ADR-0002 (Pure LangGraph) remains valid for the archived Python codebase but is **superseded for all new TS implementation work**. Going forward, any reference to "Strategic Loop graph" or "LangGraph node" in the design docs maps to a step in the TS state machine.
