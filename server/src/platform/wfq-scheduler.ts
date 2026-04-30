// Weighted Fair Queue scheduler for cross-workspace concurrency.
// Ensures no single workspace can starve others when 30 missions run in parallel.
// Per Phase-2-Platform-Workspace-Mission-Layer §2.2 (WFQ).
//
// Implementation uses GPS-style virtual finish time per packet:
//   F_i = max(arrivalVirtualTime, F_{i-1}) + 1/weight
// On dispatch we always pick the smallest F across non-empty lanes.

export interface WfqJob<T = unknown> {
  workspaceId: string;
  weight: number;
  payload: T;
}

interface QueuedJob<T> {
  job: WfqJob<T>;
  virtualFinish: number;
}

interface WorkspaceLane<T> {
  workspaceId: string;
  weight: number;
  lastEnqueuedFinish: number;
  queue: QueuedJob<T>[];
}

export interface WfqDispatchPlan<T> {
  workspaceId: string;
  job: WfqJob<T>;
}

export class WfqScheduler<T = unknown> {
  private lanes = new Map<string, WorkspaceLane<T>>();
  private virtualClock = 0;

  enqueue(job: WfqJob<T>): void {
    const lane = this.getOrCreateLane(job.workspaceId, job.weight);
    const start = Math.max(this.virtualClock, lane.lastEnqueuedFinish);
    const finish = start + 1 / lane.weight;
    lane.lastEnqueuedFinish = finish;
    lane.queue.push({ job, virtualFinish: finish });
  }

  size(): number {
    let total = 0;
    for (const lane of this.lanes.values()) total += lane.queue.length;
    return total;
  }

  laneSize(workspaceId: string): number {
    return this.lanes.get(workspaceId)?.queue.length ?? 0;
  }

  /**
   * Drain up to `n` jobs in fair order.
   */
  dispatch(n: number): WfqDispatchPlan<T>[] {
    const plan: WfqDispatchPlan<T>[] = [];
    for (let i = 0; i < n; i++) {
      const lane = this.pickNextLane();
      if (!lane) break;
      const head = lane.queue.shift()!;
      this.virtualClock = head.virtualFinish;
      plan.push({ workspaceId: lane.workspaceId, job: head.job });
    }
    return plan;
  }

  private pickNextLane(): WorkspaceLane<T> | null {
    let best: WorkspaceLane<T> | null = null;
    let bestFinish = Infinity;
    for (const lane of this.lanes.values()) {
      const head = lane.queue[0];
      if (!head) continue;
      if (head.virtualFinish < bestFinish) {
        best = lane;
        bestFinish = head.virtualFinish;
      }
    }
    return best;
  }

  private getOrCreateLane(workspaceId: string, weight: number): WorkspaceLane<T> {
    let lane = this.lanes.get(workspaceId);
    if (!lane) {
      lane = {
        workspaceId,
        weight: Math.max(1, weight),
        lastEnqueuedFinish: this.virtualClock,
        queue: [],
      };
      this.lanes.set(workspaceId, lane);
    } else if (lane.weight !== weight) {
      lane.weight = Math.max(1, weight);
    }
    return lane;
  }
}
