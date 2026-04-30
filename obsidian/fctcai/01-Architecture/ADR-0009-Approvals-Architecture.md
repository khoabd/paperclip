# ADR-0009: Approvals Architecture — Extend Existing `approvals` Table

**Status**: Accepted
**Date**: 2026-04-29

## Context

Two design surfaces touch approvals with different schemas:

1. **Existing paperclip `approvals` table** — simple: `id, company_id, type, status, payload, decision_note, decided_by_user_id, decided_at, created_at`. Currently used for `hire_agent` and `approve_ceo_strategy`.
2. **Auto-Ops design `approval_items`** — richer: adds `risk_score INT`, `risk_level TEXT`, `risk_factors JSONB`, `priority INT`, `options JSONB`, `timeout_hours INT`, `timeout_action TEXT`, `can_delegate BOOLEAN`, `delegated_to TEXT`.
3. **Autonomy-Dial design** — adds: `proposal_pattern ENUM(confirm|choose|edit|decide)`, `confidence NUMERIC`, `time_to_decision_seconds INT`, `dragIn` self-report.

The Implementation Plan v1 said "extend `approvals`" without resolving which fields. Implementing both tables in parallel, or using one for some flows and the other for others, would fragment the approval surface.

## Decision

**Extend the existing `approvals` table.** Do not create `approval_items`.

Add columns:
- `proposal_pattern` ENUM(`confirm`, `choose`, `edit`, `decide`) — required for new approvals
- `confidence` NUMERIC — agent's self-reported confidence at proposal time (0..1)
- `risk_score` INT — 0..100, computed by risk scorer
- `risk_level` TEXT — `low` | `medium` | `high` | `critical` (denormalized from risk_score for filter speed)
- `priority` INT — 0 (low) .. 100 (critical), used by notification batcher
- `timeout_hours` INT NULL — soft deadline for human response
- `timeout_action` TEXT NULL — `auto_approve` | `auto_reject` | `escalate` | `null` (default null = block until human)
- `can_delegate` BOOLEAN DEFAULT FALSE
- `delegated_to_user_id` UUID NULL FK auth_users
- `time_to_decision_seconds` INT NULL — populated on decide
- `metadata` JSONB DEFAULT '{}' — open-ended (drag-in self-report, surface, batch_id, etc.)

Existing fields stay:
- `payload` JSONB continues to carry pattern-specific data:
  - For `choose`: `payload.options[] = [{key, label, summary, cost_estimate, confidence}]`
  - For `edit`: `payload.draft = {...}` + `payload.schema = {...}`
  - For `decide`: `payload.context = {...}` + free-form
  - For `confirm`: `payload.action = {...}`

Type ENUM expands to include all design types (sprint_plan, intake_workflow_branch, deploy_to_stag, kill_switch_decision, etc.) — open string, no DB enum to keep flexibility.

## Rationale

- **Minimum schema churn** — paperclip already has working approvals; existing rows survive.
- **Single approval surface** — Approval Center UI reads one table, filters by `proposal_pattern` and `risk_level`.
- **Migration path is additive** — existing `hire_agent` rows just have NULL on new columns; backfill `proposal_pattern='confirm'` post-deploy.
- **`payload` JSONB carries pattern-specific shape** — avoids needing 4 different tables for 4 patterns. Schema validation lives in TS layer.
- **Indexes added**: `(company_id, status, priority DESC)` for inbox queries; `(company_id, proposal_pattern)`; `(delegated_to_user_id, status) WHERE delegated_to_user_id IS NOT NULL`.

## Consequences

- ✅ Phase 3 (Autonomy + Approval Pattern) ships as one migration.
- ✅ Existing approval flows (`hire_agent`, `approve_ceo_strategy`) keep working.
- ✅ Risk scoring + timeout actions + delegation all colocated.
- ✅ Auto-Ops design's `approval_items` features all map cleanly.
- ⚠️ `payload` JSONB is overloaded — risk of inconsistent shapes. Mitigation: TS Zod schemas per `(type, proposal_pattern)`; validation on insert.
- ⚠️ Heavy JSONB queries can slow down at scale. Mitigation: only filter/sort on top-level columns; treat `payload` as read-on-fetch.
- ⚠️ Some Auto-Ops fields (e.g. `risk_factors[]`) live in `metadata.risk_factors` not promoted columns. Acceptable for V1; promote if query patterns demand.

## Migration

```sql
ALTER TABLE approvals
  ADD COLUMN proposal_pattern TEXT,
  ADD COLUMN confidence NUMERIC,
  ADD COLUMN risk_score INT,
  ADD COLUMN risk_level TEXT,
  ADD COLUMN priority INT DEFAULT 50,
  ADD COLUMN timeout_hours INT,
  ADD COLUMN timeout_action TEXT,
  ADD COLUMN can_delegate BOOLEAN DEFAULT FALSE,
  ADD COLUMN delegated_to_user_id UUID REFERENCES auth_users(id),
  ADD COLUMN time_to_decision_seconds INT,
  ADD COLUMN metadata JSONB DEFAULT '{}';

UPDATE approvals SET proposal_pattern = 'confirm' WHERE proposal_pattern IS NULL;

ALTER TABLE approvals ALTER COLUMN proposal_pattern SET NOT NULL;

CREATE INDEX approvals_inbox_idx ON approvals (company_id, status, priority DESC);
CREATE INDEX approvals_pattern_idx ON approvals (company_id, proposal_pattern);
CREATE INDEX approvals_delegated_idx ON approvals (delegated_to_user_id, status)
  WHERE delegated_to_user_id IS NOT NULL;
```

## Pattern-payload contracts (TS Zod, lives at `packages/shared/src/approvals/schemas.ts`)

```ts
const ConfirmPayload = z.object({
  action: z.object({ kind: z.string(), summary: z.string(), preview: z.unknown().optional() }),
});

const ChoosePayload = z.object({
  options: z.array(z.object({
    key: z.string(),
    label: z.string(),
    summary: z.string(),
    costEstimateUsd: z.number().optional(),
    confidence: z.number().min(0).max(1).optional(),
  })).min(2).max(7),
});

const EditPayload = z.object({
  draft: z.unknown(),
  schema: z.unknown(),
  notes: z.string().optional(),
});

const DecidePayload = z.object({
  context: z.string(),
  questions: z.array(z.string()).optional(),
});

export const ApprovalPayload = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("confirm"), payload: ConfirmPayload }),
  z.object({ kind: z.literal("choose"),  payload: ChoosePayload  }),
  z.object({ kind: z.literal("edit"),    payload: EditPayload    }),
  z.object({ kind: z.literal("decide"),  payload: DecidePayload  }),
]);
```

## Future evolution

If V1 metrics show frequent JSONB scans on `metadata.risk_factors` or `payload.options`, promote those to columns or to a `approval_options` side-table. This is a non-breaking change — clients fall back to JSONB read until promotion lands.
