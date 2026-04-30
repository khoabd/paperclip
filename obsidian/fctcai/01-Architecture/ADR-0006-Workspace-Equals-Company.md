# ADR-0006: Workspace = Company (Direct Map)

**Status**: Accepted
**Date**: 2026-04-29

## Context

`Paperclip-Platform-Workspace-Mission-Model` introduces a 3-layer model:
- **Platform** — shared agent pool, skill library, tool registry (singleton, instance-wide)
- **Workspace** — isolated tenant: its own goals, projects, brain, autonomy policy
- **Mission** — a unit of work executed inside a workspace

Paperclip already has a `companies` table that:
- Owns goals, projects, issues, agents, secrets, plugins, sprints, releases
- Is the unit of membership (`company_memberships`) and permissions (`principal_permission_grants`)
- Is the boundary for budgets, costs, activity log
- Has a one-or-more relationship with users via `company_memberships`

Two modeling options were on the table:
- A. Add a new `workspaces` table that lives **inside** a company (1 company → N workspaces).
- B. **Map workspace 1:1 onto company.** Every "workspace" in the design = one company row.

## Decision

**Option B — workspace IS company.** Wherever the design says "workspace", the implementation reads `companyId`. We do not add a `workspaces` table.

`projects` and `issues` continue to be the natural sub-grouping inside a workspace. Multi-tenant isolation is already enforced at the `companyId` boundary throughout the codebase.

## Rationale

- **Massive reuse**: every existing query, RBAC check, budget gate, plugin scope, secret namespace, activity feed, and sprint already keys on `companyId`. Adding a parallel `workspaceId` would require shadowing all of them.
- **One-tenant-equals-one-workspace** matches every persona in the UX-Strategy doc — there is no design feature that distinguishes "company" from "workspace" semantically.
- **Future flexibility preserved**: if a single user later needs N workspaces, they spin up N companies (already supported via memberships); they can sit on multiple. No schema change.
- **Plugin / agent scope is already company-scoped**, which is exactly what the design wants for workspace.

## Consequences

- ✅ Zero new tables for the workspace concept.
- ✅ All design doc references to "workspace_id" implement as `company_id`.
- ✅ Cross-workspace learning (Platform layer) maps to a new `platform_*` set of tables explicitly outside `companies` (skill library, tool registry, agent pool catalog).
- ⚠️ The word "workspace" in the design docs and "company" in the code will diverge — mitigation: wiki tag `[[Workspace]]` redirects to `companies`; ADR linked from `_index.md`.
- ⚠️ If we ever need sub-workspaces inside a company (unlikely), we'd add a `workspaces` table at that point — it's an additive change.

## Naming convention

In TypeScript code we keep the existing `companyId` field name. In **user-facing strings, dashboards, and CLI**, we use "Workspace" — consistent with the design's mental model. A small `formatWorkspace(company)` helper handles labels.

The Platform layer remains its own slice:
- `platformAgents` (catalog), `platformSkills`, `platformTools` — instance-singleton, no `companyId`.
- A workspace "rents" capability from these via existing `agents` (per-company instances) and `companySkills`.
