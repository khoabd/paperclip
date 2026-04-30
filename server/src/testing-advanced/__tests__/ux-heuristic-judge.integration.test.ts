// Integration tests for UXHeuristicJudge.
// Gate criteria:
//   7 dimensions returned by mock LLM → 7 ux_judge_scores rows persisted.
//   averageScore computed correctly.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql, eq } from "drizzle-orm";
import { uxJudgeScores } from "@paperclipai/db/schema/ux_judge_scores";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { UXHeuristicJudge } from "../ux-heuristic-judge.js";
import { TestRunStore } from "../../testing-foundation/test-run-store.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping UXHeuristicJudge integration: ${support.reason ?? "unsupported"}`);
}

desc("UXHeuristicJudge integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let judge!: UXHeuristicJudge;
  let runStore!: TestRunStore;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("ux-judge-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    judge = new UXHeuristicJudge(db);
    runStore = new TestRunStore(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM ux_judge_scores`);
    await db.execute(sql`DELETE FROM test_runs`);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedCompany(prefix: string): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name: `UXCo-${prefix}`,
      issuePrefix: `UX${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  /** Deterministic mock LLM: returns all 7 UX heuristic dimensions with fixed scores. */
  const mockLLMCallback = async () => [
    { dimension: "clarity",       score: 85, reasoning: "Clear visual hierarchy" },
    { dimension: "hierarchy",     score: 78, reasoning: "Good use of typography scale" },
    { dimension: "consistency",   score: 92, reasoning: "Uniform component library usage" },
    { dimension: "affordance",    score: 71, reasoning: "Most interactive elements are clear" },
    { dimension: "feedback",      score: 68, reasoning: "Loading states present but subtle" },
    { dimension: "accessibility", score: 55, reasoning: "Some contrast issues found" },
    { dimension: "delight",       score: 80, reasoning: "Animations are smooth and purposeful" },
  ];

  it("7 dimensions from mock LLM → 7 ux_judge_scores rows persisted", async () => {
    const companyId = await seedCompany("7d");
    const run = await runStore.create({
      companyId,
      dimension: "ux_judge",
      prRef: `pr-ux-${randomUUID().slice(0, 8)}`,
    });

    const result = await judge.judge(
      run.id,
      "<screenshot-data>",
      "<dom-snapshot>",
      mockLLMCallback,
      { model: "gpt-4o-stub", screenshotUri: "s3://ux/screenshot.png" },
    );

    expect(result.rows).toHaveLength(7);

    const dimensions = result.rows.map((r) => r.dimension).sort();
    expect(dimensions).toEqual([
      "accessibility", "affordance", "clarity", "consistency",
      "delight", "feedback", "hierarchy",
    ]);

    // averageScore = (85+78+92+71+68+55+80) / 7 = 529/7 ≈ 75.57
    expect(result.averageScore).toBeCloseTo(75.57, 1);

    // Verify all 7 rows in DB
    const dbRows = await db
      .select()
      .from(uxJudgeScores)
      .where(eq(uxJudgeScores.testRunId, run.id));
    expect(dbRows).toHaveLength(7);

    // Verify model and screenshotUri are stored
    for (const row of dbRows) {
      expect(row.model).toBe("gpt-4o-stub");
      expect(row.screenshotUri).toBe("s3://ux/screenshot.png");
    }
  });

  it("scores are correctly stored as numeric strings and parse back", async () => {
    const companyId = await seedCompany("num");
    const run = await runStore.create({
      companyId,
      dimension: "ux_judge",
      prRef: `pr-ux-${randomUUID().slice(0, 8)}`,
    });

    await judge.judge(run.id, "<sc>", "<dom>", mockLLMCallback);

    const dbRows = await db
      .select()
      .from(uxJudgeScores)
      .where(eq(uxJudgeScores.testRunId, run.id));

    for (const row of dbRows) {
      const parsed = parseFloat(String(row.score));
      expect(parsed).toBeGreaterThan(0);
      expect(parsed).toBeLessThanOrEqual(100);
    }
  });

  it("empty LLM response → 0 rows, averageScore=0", async () => {
    const companyId = await seedCompany("emp");
    const run = await runStore.create({
      companyId,
      dimension: "ux_judge",
      prRef: `pr-ux-${randomUUID().slice(0, 8)}`,
    });

    const result = await judge.judge(
      run.id,
      "<sc>",
      "<dom>",
      async () => [],
    );

    expect(result.rows).toHaveLength(0);
    expect(result.averageScore).toBe(0);
  });
});
