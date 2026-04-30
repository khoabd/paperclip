# FCTCAI — Factory Floor AI Console

> **Mission**: Run a fully autonomous AI software company — from product ideation to deployment — observable in real-time on the Factory Floor console.

---

## Master Design

→ **[[01-Architecture/MASTER-DESIGN]]** ← Start here. Full 8-layer spec, all phases, open questions.

---

## Architecture

→ **[[01-Architecture/_index|01-Architecture]]** ← Tất cả ADRs, design docs, phase plans

| Document | Purpose |
|---------|---------|
| [[01-Architecture/Overview]] | System overview + implementation phase tracker |
| [[01-Architecture/MASTER-DESIGN]] | Full 8-layer spec |
| [[01-Architecture/00-Master-Architecture-Overview]] | Master overview |
| [[01-Architecture/ADR-0002-Pure-LangGraph]] | LangGraph over Temporal |
| [[01-Architecture/ADR-0003-Strategic-Loop-Runtime]] | Strategic loop runtime |
| [[01-Architecture/ADR-0006-Workspace-Equals-Company]] | Workspace = Company |
| [[01-Architecture/ADR-0007-Brain-Storage]] | Brain as document |
| [[01-Architecture/ADR-0009-Approvals-Architecture]] | Approvals extension |
| [[01-Architecture/ADR-0010-MCP-Client-Framework]] | MCP client framework |

## Phase Design Docs

| Phase | Document |
|-------|---------|
| Phase 1: External Integrations | [[01-Architecture/Phases/Phase-1-External-Integrations]] |
| Phase 2: Platform/Workspace/Mission | [[01-Architecture/Phases/Phase-2-Platform-Workspace-Mission-Layer]] |
| Phase 3: Autonomy Dial + Approvals | [[01-Architecture/Phases/Phase-3-Autonomy-Dial-Approval-Patterns]] |
| Phase 4: Strategic Loop Foundation | [[01-Architecture/Phases/Phase-4-Strategic-Loop-Foundation]] |
| Phase 5: Human Intake Hub | [[01-Architecture/Phases/Phase-5-Human-Intake-Hub]] |
| Phase 6: Self-Healing | [[01-Architecture/Phases/Phase-6-Self-Healing-Extension]] |
| Phase 7: Dev Flow + Feature Flags | [[01-Architecture/Phases/Phase-7-Development-Flow-Feature-Flags]] |
| Phase 8: Greenfield Bootstrap | [[01-Architecture/Phases/Phase-8-Greenfield-Bootstrap]] |
| Phase 9: Decision Boundary + Brier | [[01-Architecture/Phases/Phase-9-Decision-Boundary-Brier-Calibration]] |
| Phase 10: Rejection Learning DBSCAN | [[01-Architecture/Phases/Phase-10-Rejection-Learning-DBSCAN]] |
| Phase 11: Knowledge Base + Magika | [[01-Architecture/Phases/Phase-11-Knowledge-Base-Magika]] |
| Phase 12: Cross-Repo Coordination | [[01-Architecture/Phases/Phase-12-Cross-Repo-Coordination]] |
| Phase 14a/b/c: Testing Foundation/Advanced/Operational | [[01-Architecture/Phases/Phase-14a-Testing-Foundation]] · [[01-Architecture/Phases/Phase-14b-Testing-Advanced]] · [[01-Architecture/Phases/Phase-14c-Testing-Operational]] |
| Phase 15: Release Hardening | [[01-Architecture/Phases/Phase-15-Release-Hardening]] |

---

## Test Plan

→ **[[02-Test-Plan/_index]]** — 77 test scenarios across 8 layers (infrastructure, e2e, cp, chaos, load, manual, smoke, product lifecycle)

| Document | Purpose |
|---------|---------|
| [[02-Test-Plan/_index]] | Hub điều hướng test scenarios |
| [[02-Test-Plan/00-Evaluation-Report]] | 5-dimension evaluation (QA, quality, perf, business, completion) |
| [[02-Test-Plan/01-Gap-Analysis]] | Test plan vs design coverage analysis |
| [[02-Test-Plan/quality-gates]] | Block conditions, soak windows, rollback triggers |

**Đỉnh kim tự tháp (north star):**
- [[02-Test-Plan/product/TC-PRODUCT-01]] — 90-day single-product lifecycle
- [[02-Test-Plan/product/TC-PRODUCT-09]] — KPI delivery acceptance (5 north star metrics)
- [[02-Test-Plan/product/TC-PRODUCT-03]] — Founder absence safety

---
