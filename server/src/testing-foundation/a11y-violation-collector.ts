// A11yViolationCollector — records axe-core-shaped violations and summarises by impact.
// Phase 14a §Services.3.

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { a11yViolations } from "@paperclipai/db/schema/a11y_violations";

export interface AxeViolation {
  ruleId: string;
  /** minor | moderate | serious | critical */
  impact: string;
  targetSelector: string;
  htmlSnippet?: string | null;
  helpUrl?: string | null;
}

export interface ImpactSummary {
  minor: number;
  moderate: number;
  serious: number;
  critical: number;
  total: number;
}

export class A11yViolationCollector {
  constructor(private readonly db: Db) {}

  /**
   * Bulk-inserts a list of axe-core violations for a test run.
   * Idempotent in the sense that it always appends; callers are responsible
   * for not calling twice for the same run.
   */
  async record(testRunId: string, violations: AxeViolation[]): Promise<void> {
    if (violations.length === 0) return;

    const rows = violations.map((v) => ({
      testRunId,
      ruleId: v.ruleId,
      impact: v.impact,
      targetSelector: v.targetSelector,
      htmlSnippet: v.htmlSnippet ?? null,
      helpUrl: v.helpUrl ?? null,
      createdAt: new Date(),
    }));

    await this.db.insert(a11yViolations).values(rows);
  }

  /**
   * Returns violation counts grouped by impact level for a given test run.
   */
  async summary(testRunId: string): Promise<ImpactSummary> {
    const rows = await this.db
      .select({ impact: a11yViolations.impact })
      .from(a11yViolations)
      .where(eq(a11yViolations.testRunId, testRunId));

    const counts: ImpactSummary = { minor: 0, moderate: 0, serious: 0, critical: 0, total: 0 };
    for (const r of rows) {
      const k = r.impact as keyof Omit<ImpactSummary, "total">;
      if (k in counts) counts[k]++;
      counts.total++;
    }
    return counts;
  }
}
