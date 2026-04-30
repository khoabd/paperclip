# ADR-0002: Pure LangGraph over Temporal

**Status**: Accepted  
**Date**: 2026-04-24

## Context

FCTCAI needs a workflow orchestration layer for multi-department missions. Candidates evaluated: Temporal, Prefect, Pure LangGraph, Custom asyncio.

## Decision

**Pure LangGraph** — departments are LangGraph nodes, mission is a LangGraph graph, state is a typed TypedDict passed between nodes.

## Rationale

At FCTCAI's scale (10s of concurrent missions, not 1000s):
- Temporal adds operational complexity (separate cluster, Temporal workers, SDK) not justified
- LangGraph is already in our dependency tree (LangChain ecosystem)
- LangGraph StateGraph gives us conditional edges (branching dept flows) natively
- LangGraph checkpointing integrates with our PostgreSQL MissionCheckpointer

## Consequences

- ✅ No additional infrastructure (no Temporal cluster)
- ✅ Native Python, easy to debug and test
- ✅ LangGraph graph visualization can be exported
- ⚠️ If we scale to 10k+ concurrent missions, may need to revisit (Temporal's strength)
- ⚠️ LangGraph is less mature than Temporal for production reliability
