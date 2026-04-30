// VisualBaselineStore — manages screenshot baselines lifecycle.
// Phase 14a §Services.2.

import { eq, and, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { visualBaselines } from "@paperclipai/db/schema/visual_baselines";

export interface RegisterBaselineInput {
  company: string;
  route: string;
  viewport: string;
  browser: string;
  imageUri: string;
  sha: string;
}

export interface VisualBaselineRow {
  id: string;
  companyId: string;
  route: string;
  viewport: string;
  browser: string;
  imageUri: string;
  sha: string;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  archived: boolean;
  createdAt: Date;
}

export class VisualBaselineStore {
  constructor(private readonly db: Db) {}

  /**
   * Registers a new baseline. Archives any previously active baseline for the
   * same (company, route, viewport, browser) triple before inserting.
   */
  async register(input: RegisterBaselineInput): Promise<VisualBaselineRow> {
    // Archive any existing active baseline for this slot
    await this.db
      .update(visualBaselines)
      .set({ archived: true })
      .where(
        and(
          eq(visualBaselines.companyId, input.company),
          eq(visualBaselines.route, input.route),
          eq(visualBaselines.viewport, input.viewport),
          eq(visualBaselines.browser, input.browser),
          eq(visualBaselines.archived, false),
        ),
      );

    const [row] = await this.db
      .insert(visualBaselines)
      .values({
        companyId: input.company,
        route: input.route,
        viewport: input.viewport,
        browser: input.browser,
        imageUri: input.imageUri,
        sha: input.sha,
        archived: false,
        createdAt: new Date(),
      })
      .returning();

    return row as VisualBaselineRow;
  }

  /**
   * Returns the active (non-archived) baseline for a slot, or null if none.
   */
  async findActive(
    company: string,
    route: string,
    viewport: string,
    browser: string,
  ): Promise<VisualBaselineRow | null> {
    const rows = await this.db
      .select()
      .from(visualBaselines)
      .where(
        and(
          eq(visualBaselines.companyId, company),
          eq(visualBaselines.route, route),
          eq(visualBaselines.viewport, viewport),
          eq(visualBaselines.browser, browser),
          eq(visualBaselines.archived, false),
        ),
      );

    return (rows[0] as VisualBaselineRow) ?? null;
  }

  /**
   * Archives a baseline by id. Safe to call on an already-archived row.
   */
  async archive(id: string): Promise<void> {
    await this.db
      .update(visualBaselines)
      .set({ archived: true })
      .where(eq(visualBaselines.id, id));
  }
}
