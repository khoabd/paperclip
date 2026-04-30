// UXHeuristicJudge — LLM-as-Judge for UX heuristic scoring.
// The LLM call is fully injected via `llmCallback` — tests use deterministic stubs.
// Phase 14b §Services.4.
//
// Dimensions: clarity | hierarchy | consistency | affordance | feedback | accessibility | delight

import type { Db } from "@paperclipai/db";
import { uxJudgeScores } from "@paperclipai/db/schema/ux_judge_scores";

export interface LLMJudgeInput {
  screenshot: string;
  dom: string;
}

export interface LLMJudgeDimensionResult {
  dimension: string;
  score: number;
  reasoning: string;
}

/** Injected callback that wraps the real LLM call (mocked in tests). */
export type LLMCallback = (
  input: LLMJudgeInput,
) => Promise<LLMJudgeDimensionResult[]>;

export interface UXJudgeScoreRow {
  id: string;
  testRunId: string;
  dimension: string;
  score: string;
  reasoning: string | null;
  screenshotUri: string | null;
  model: string;
  createdAt: Date;
}

export interface JudgeResult {
  rows: UXJudgeScoreRow[];
  averageScore: number;
}

export class UXHeuristicJudge {
  constructor(private readonly db: Db) {}

  /**
   * Sends the screenshot + DOM to the LLM via `llmCallback`, persists each
   * dimension score into ux_judge_scores, and returns all rows + average score.
   *
   * The LLM contract: returns an array of { dimension, score, reasoning }.
   * Expected 7 dimensions: clarity, hierarchy, consistency, affordance,
   *                        feedback, accessibility, delight.
   */
  async judge(
    testRunId: string,
    screenshot: string,
    dom: string,
    llmCallback: LLMCallback,
    opts?: { model?: string; screenshotUri?: string },
  ): Promise<JudgeResult> {
    const model = opts?.model ?? "gpt-4o";
    const screenshotUri = opts?.screenshotUri ?? null;

    const dimensions = await llmCallback({ screenshot, dom });

    const rows: UXJudgeScoreRow[] = [];
    let scoreSum = 0;

    for (const dim of dimensions) {
      const [row] = await this.db
        .insert(uxJudgeScores)
        .values({
          testRunId,
          dimension: dim.dimension,
          score: String(dim.score),
          reasoning: dim.reasoning,
          screenshotUri,
          model,
          createdAt: new Date(),
        })
        .returning();
      rows.push(row as UXJudgeScoreRow);
      scoreSum += dim.score;
    }

    const averageScore = rows.length > 0 ? scoreSum / rows.length : 0;

    return { rows, averageScore };
  }
}
