// Pure DBSCAN clusterer using cosine distance.
// Per Phase-10 spec §10.2, ADR-0005: eps=0.25, minPoints=3.
// Hand-written DBSCAN (~50 lines) so no external dependency is required.

export interface EmbeddingPoint {
  id: string;
  embedding: number[];
}

export interface ClusterResult {
  /** Map from point id → cluster index (0-based). -1 = noise. */
  assignments: Map<string, number>;
  /** Number of clusters found (excluding noise). */
  clusterCount: number;
}

// ---------------------------------------------------------------------------
// Cosine distance (0 = identical, 2 = opposite)
// ---------------------------------------------------------------------------
function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  if (normA === 0 || normB === 0) return 1; // treat zero vectors as maximally distant
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------------------------------------------------------------------------
// DBSCAN
// ---------------------------------------------------------------------------
const UNVISITED = -2;
const NOISE = -1;

export class DBSCANClusterer {
  constructor(
    private readonly eps: number = 0.25,
    private readonly minPoints: number = 3,
  ) {}

  cluster(points: EmbeddingPoint[]): ClusterResult {
    const n = points.length;
    const clusterOf = new Array<number>(n).fill(UNVISITED);
    let nextCluster = 0;

    // Build neighbour list for each point
    const neighbours = (idx: number): number[] => {
      const result: number[] = [];
      for (let j = 0; j < n; j++) {
        if (j === idx) continue;
        if (cosineDistance(points[idx]!.embedding, points[j]!.embedding) <= this.eps) {
          result.push(j);
        }
      }
      return result;
    };

    for (let i = 0; i < n; i++) {
      if (clusterOf[i] !== UNVISITED) continue;

      const nbrs = neighbours(i);
      if (nbrs.length < this.minPoints - 1) {
        // -1 because the point itself is not in nbrs
        clusterOf[i] = NOISE;
        continue;
      }

      const c = nextCluster++;
      clusterOf[i] = c;

      const queue = [...nbrs];
      while (queue.length > 0) {
        const q = queue.shift()!;
        if (clusterOf[q] === NOISE) {
          clusterOf[q] = c; // border point — absorb into cluster
          continue;
        }
        if (clusterOf[q] !== UNVISITED) continue; // already processed

        clusterOf[q] = c;
        const qNbrs = neighbours(q);
        if (qNbrs.length >= this.minPoints - 1) {
          queue.push(...qNbrs);
        }
      }
    }

    const assignments = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      assignments.set(points[i]!.id, clusterOf[i] === UNVISITED ? NOISE : clusterOf[i]!);
    }

    return { assignments, clusterCount: nextCluster };
  }
}

// Compute centroid (mean) of a set of embeddings
export function computeCentroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  const dim = embeddings[0]!.length;
  const centroid = new Array<number>(dim).fill(0);
  for (const emb of embeddings) {
    for (let d = 0; d < dim; d++) {
      centroid[d]! += (emb[d] ?? 0) / embeddings.length;
    }
  }
  return centroid;
}
