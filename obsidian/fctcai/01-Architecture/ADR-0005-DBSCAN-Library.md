# ADR-0005: DBSCAN Implementation for Feedback Clustering

**Status**: Accepted
**Date**: 2026-04-29

## Context

`Rejection-Learning-and-Feedback-Loop` and `Human-Intake-and-Solution-Loop-Design` both rely on **DBSCAN** to cluster feedback / rejection events:
- eps = 0.25 (cosine distance on `text-embedding-3-small` vectors)
- min_samples = 3
- Auto-promote a cluster to an intake item when ≥5 events appear within a 14-day window.

We need a TypeScript-friendly DBSCAN implementation that:
- Accepts a custom distance function (cosine).
- Handles ~10k–100k points within reasonable memory.
- Has zero / low maintenance burden.

Candidates:
- A. `density-clustering` (npm) — simple, ~3 yrs since last commit but stable, custom distance via constructor.
- B. `ml-dbscan` (mljs) — actively maintained, uses Euclidean by default, custom metric supported.
- C. Hand-roll DBSCAN (~80 LOC).
- D. Defer to Postgres + pgvector with a manual neighbour-graph CTE.

## Decision

**Option A — `density-clustering` npm package**, with a thin wrapper that converts cosine distance via 1 − dot(unit, unit) before passing to the library.

Wrapper lives at `packages/shared/src/clustering/dbscan.ts`:

```ts
import * as DC from "density-clustering";

export interface DbscanOptions {
  eps: number;
  minPoints: number;
}

export function dbscanCosine(
  vectors: number[][],
  opts: DbscanOptions = { eps: 0.25, minPoints: 3 }
): number[][] {
  const dbscan = new DC.DBSCAN();
  return dbscan.run(vectors, opts.eps, opts.minPoints, cosineDistance);
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}
```

## Rationale

- **Zero migration risk**: `density-clustering` has been stable for years; the algorithm is finished, not evolving.
- **Single-purpose dep**: ~5KB, no transitive bloat.
- **Custom distance** matches our cosine-on-embedding requirement.
- **Performance is sufficient**: at 10k points × 1536-dim with eps=0.25, ~2–4s on the API tier — acceptable for the 5-min batch cycle.
- **No vendor lock**: swapping to `ml-dbscan` or hand-rolled later is local to this wrapper.

## Consequences

- ✅ One canonical clustering API (`dbscanCosine`) used by feedback, rejection, intake, and any future similarity grouping.
- ✅ Tests can pin behavior by snapshotting cluster IDs for fixture vectors.
- ⚠️ Library is in maintenance mode; if it breaks on a Node major bump, switch to `ml-dbscan` (≤1-day refactor).
- ⚠️ Above ~100k points, DBSCAN becomes O(n²) without an index; mitigation: pre-filter by HNSW (pgvector) and run DBSCAN on the candidate set.

## Tuning

`eps` and `minPoints` are stored in `instance_settings` so they can be tuned without redeploy. Default per design: `eps=0.25, minPoints=3`. Auto-promotion threshold (≥5 events / 14 days) is independent and lives in the intake-trigger module.
