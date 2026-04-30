// VectorClockAuditor — bump, compare, and stale-clock detection.
// Phase 12 §Services.3.

import { eq, and, lt } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { vectorClocks } from "@paperclipai/db/schema/vector_clocks";

export type ClockComparison = "before" | "after" | "concurrent";

export interface ClockRow {
  id: string;
  companyId: string;
  scope: string;
  scopeId: string;
  clock: Record<string, number>;
  lastUpdatedAt: Date;
}

export class VectorClockAuditor {
  constructor(private readonly db: Db) {}

  /**
   * Increments the logical counter for `node` in the vector clock identified by
   * (companyId, scope, scopeId). Creates the row if it doesn't exist.
   * Returns the updated clock map.
   */
  async bump(
    companyId: string,
    scope: string,
    scopeId: string,
    node: string,
  ): Promise<Record<string, number>> {
    const existing = await this.db
      .select()
      .from(vectorClocks)
      .where(
        and(
          eq(vectorClocks.companyId, companyId),
          eq(vectorClocks.scope, scope),
          eq(vectorClocks.scopeId, scopeId),
        ),
      );

    const now = new Date();

    if (existing.length === 0) {
      const newClock: Record<string, number> = { [node]: 1 };
      await this.db.insert(vectorClocks).values({
        companyId,
        scope,
        scopeId,
        clock: newClock,
        lastUpdatedAt: now,
      });
      return newClock;
    }

    const current = (existing[0].clock as Record<string, number>) ?? {};
    const updated: Record<string, number> = {
      ...current,
      [node]: (current[node] ?? 0) + 1,
    };

    await this.db
      .update(vectorClocks)
      .set({ clock: updated, lastUpdatedAt: now })
      .where(eq(vectorClocks.id, existing[0].id));

    return updated;
  }

  /**
   * Compares two vector clock maps.
   *
   * - `before` : every key in `a` is <= corresponding key in `b`, and at least
   *              one is strictly less (a happened before b).
   * - `after`  : every key in `b` is <= corresponding key in `a`, and at least
   *              one is strictly less (a happened after b).
   * - `concurrent`: neither dominates the other.
   */
  compare(a: Record<string, number>, b: Record<string, number>): ClockComparison {
    const allNodes = new Set([...Object.keys(a), ...Object.keys(b)]);

    let aLessB = false;
    let bLessA = false;

    for (const node of allNodes) {
      const av = a[node] ?? 0;
      const bv = b[node] ?? 0;
      if (av < bv) aLessB = true;
      if (bv < av) bLessA = true;
    }

    if (aLessB && !bLessA) return "before";
    if (bLessA && !aLessB) return "after";
    if (!aLessB && !bLessA) {
      // All values equal — treat as concurrent (no causal relationship)
      return "concurrent";
    }
    return "concurrent";
  }

  /**
   * Returns all vector clocks for `companyId` whose `last_updated_at` is older
   * than 2 hours. Intended to be called by a scheduler; no cron is wired here.
   */
  async staleAudit(companyId: string): Promise<ClockRow[]> {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const rows = await this.db
      .select()
      .from(vectorClocks)
      .where(
        and(
          eq(vectorClocks.companyId, companyId),
          lt(vectorClocks.lastUpdatedAt, twoHoursAgo),
        ),
      );

    return rows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      scope: r.scope,
      scopeId: r.scopeId,
      clock: (r.clock as Record<string, number>) ?? {},
      lastUpdatedAt: r.lastUpdatedAt,
    }));
  }
}
