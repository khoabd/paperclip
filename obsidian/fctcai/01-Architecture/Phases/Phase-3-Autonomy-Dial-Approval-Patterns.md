# Phase 3 — Autonomy Dial + Approval Pattern Extension

**Status:** in progress (Apr 29)
**Owner:** Khoa
**Depends on:** Phase 2 (autonomy_level on companies; capability_registry; workspace_capability_overrides)
**Anchors:** [[../ADR-0009-Approvals-Architecture]] · [[../Master-Architecture-Overview]]

## Goal

Make every agent action *gateable*: given an action's capability + risk + confidence and a workspace's autonomy level, decide deterministically whether to (a) auto-approve, (b) require human approval, or (c) reject. When a gate is required, create an `approvals` row using a typed Zod-validated *proposal pattern* so the UI can render an opinionated reviewer surface and the system can later calibrate (Brier).

## Non-goals (deferred)

- Brier calibration / threshold learning — Phase 9.
- Rejection clustering (DBSCAN) — Phase 10.
- Mobile-friendly approval UI polish — Phase 15.
- Delegation chains beyond a single user — out of scope until Phase 5/15.

## §3.1 Schema additions

Migration `0092_approvals_pattern_extensions.sql` (per ADR-0009: extend, do **not** add `approval_items`):

| Column | Type | Notes |
| --- | --- | --- |
| `proposal_pattern` | `text` | discriminator key (`code_change`, `external_action`, `policy_exception`, …) |
| `capability_id` | `uuid` FK `capability_registry.id` ON DELETE SET NULL | which capability this proposal exercises |
| `confidence` | `numeric(5,4)` | agent's self-reported P(success) ∈ [0,1] |
| `risk_score` | `numeric(5,4)` | gate's risk assessment ∈ [0,1] |
| `priority` | `text` default `'medium'` | `low|medium|high|urgent` |
| `timeout_at` | `timestamptz` NULL | when the gate auto-expires |
| `delegated_to_user_id` | `text` NULL | optional reviewer hand-off |
| `outcome_recorded_at` | `timestamptz` NULL | for Brier feedback loop in Phase 9 |
| `outcome` | `text` NULL | `success|failure|abandoned` once known |

Indexes: `(company_id, status, priority)`, `(timeout_at)` partial WHERE status='pending'.

Migration `0093_approval_pattern_telemetry.sql` (telemetry table — small, decoupled from `approvals` so we can prune):

```
approval_pattern_decisions
 - id uuid pk
 - company_id uuid fk companies (cascade)
 - approval_id uuid fk approvals (set null)
 - proposal_pattern text not null
 - autonomy_level text not null
 - capability_mode text not null   -- sandbox|supervised|trusted|autonomous
 - decision text not null          -- auto_approve|gate|reject
 - reason text not null            -- human-readable rule that fired
 - confidence numeric(5,4)
 - risk_score numeric(5,4)
 - decided_at timestamptz default now()
 -- index (company_id, decided_at)
 -- index (proposal_pattern, decision)
```

## §3.2 Services

`server/src/platform/autonomy/`

```
autonomy-gate.ts          Decides auto / gate / reject
proposal-patterns.ts      Zod discriminated union of payload shapes
approval-router.ts        Persists an approval with the typed payload
__tests__/
  autonomy-gate.test.ts
  proposal-patterns.test.ts
  approval-router.integration.test.ts
```

### Decision matrix

```
INPUTS:
  autonomy_level    sandbox | supervised | trusted | autonomous
  capability_mode   sandbox | supervised | trusted | autonomous (effective; override beats default)
  proposal_pattern  string
  confidence        [0,1]
  risk_score        [0,1]

EFFECTIVE_MODE = min(autonomy_level, capability_mode)   -- least permissive wins

If pattern.always_gate or risk_score >= 0.85           -> GATE
If EFFECTIVE_MODE == 'sandbox'                          -> GATE  (always)
If EFFECTIVE_MODE == 'supervised'                       -> GATE if confidence < 0.80 || risk_score > 0.30
If EFFECTIVE_MODE == 'trusted'                          -> GATE if confidence < 0.60 || risk_score > 0.55
If EFFECTIVE_MODE == 'autonomous'                       -> AUTO (still log)
If pattern is forbidden in current mode                 -> REJECT
```

The thresholds are stored in code for Phase 3; Phase 9 turns them into per-workspace + per-pattern Brier-tuned values.

### Proposal pattern catalog (initial)

- `code_change` — repo, branch, diff, summary; always gate in sandbox/supervised
- `external_action` — tool key + redacted params; risk=high default
- `policy_exception` — capability id + duration; always gate
- `cost_burst` — projected $ over budget; gates only above budget overshoot
- `data_export` — destination + scope; always gate

Each has its own Zod schema. The discriminator is `proposal_pattern`.

## §3.3 APIs (read-only this phase)

- `GET /api/companies/:id/approvals?pattern=&status=` — filter by new fields.
- `GET /api/companies/:id/autonomy/preview` — accepts a fake proposal, returns the gate decision (so the UI can show "would gate / would auto" before the agent actually fires).

POST/PATCH endpoints (decide approval, change autonomy level) reuse existing routes; they just see the new columns through the schema.

## §3.4 Gate criteria for Phase 3 closeout

- [ ] Migrations 0092 + 0093 applied; journal updated.
- [ ] Drizzle schemas updated for `approvals`; new `approval_pattern_decisions` schema.
- [ ] `AutonomyGate.decide()` produces deterministic decision + reason for every (mode × pattern × confidence × risk) cell.
- [ ] `ApprovalRouter.create()` validates payload against the right Zod schema; rejects malformed payloads before insert.
- [ ] Each pattern schema has a unit test for happy + malformed input.
- [ ] Integration test creates a workspace, runs `decide → create → fetch` and verifies the row, telemetry row, and effective_mode capture.
- [ ] `_index.md` Phase Status updated.
