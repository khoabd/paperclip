// Heuristic-first classifier over the 8 intake types from Human-Intake §2.
// Confidence ≥ 0.7 → auto-route; below that, the workflow runner emits a Choose approval.
// LLM hook is opt-in (deferred to Phase 7); when no LLM provided, we fall back to scoring.

export type IntakeType =
  | "problem"
  | "feature_request"
  | "bug_report"
  | "feedback_general"
  | "feedback_release"
  | "feedback_feature"
  | "strategic_input"
  | "question";

export interface ClassifyInput {
  text: string;
  /** If a release tag is attached, the type is forced to feedback_release. */
  linkedReleaseTag?: string | null;
  /** If a feature key is attached, type is forced to feedback_feature. */
  linkedFeatureKey?: string | null;
  /** Override hint when the human pre-selected a type. */
  prefilledType?: IntakeType | null;
}

export interface ClassifyResult {
  type: IntakeType;
  confidence: number;
  alternatives: Array<{ type: IntakeType; score: number }>;
  source: "prefilled" | "linked_release" | "linked_feature" | "heuristic" | "llm";
}

interface ScoreEntry {
  type: IntakeType;
  score: number;
}

// Keyword scoring per type. Weights chosen so a single strong phrase pushes confidence past 0.7.
const RULES: Record<IntakeType, RegExp[]> = {
  bug_report: [
    /\bbug\b/i,
    /\bcrash(?:es|ed|ing)?\b/i,
    /\brepro(?:duce|duction)?\b/i,
    /\bsteps to reproduce\b/i,
    /\bstack trace\b/i,
    /\b500\b/,
    /\b404\b/,
  ],
  problem: [
    /\bbroken\b/i,
    /\bnot working\b/i,
    /\bisn't working\b/i,
    /\bsuboptimal\b/i,
    /\bregress(?:ion|ed|ing)?\b/i,
    /\bkhông hoạt động\b/i,
    /\blỗi\b/i,
  ],
  feature_request: [
    /\badd\b/i,
    /\bsupport for\b/i,
    /\bcan we\b/i,
    /\bwould be nice\b/i,
    /\bnew feature\b/i,
    /\btính năng\b/i,
    /\bthêm\b/i,
  ],
  feedback_general: [
    /\bi think\b/i,
    /\bI feel\b/i,
    /\bmy opinion\b/i,
    /\bjust noting\b/i,
    /\bnit\b/i,
    /\bý kiến\b/i,
  ],
  feedback_release: [/\brelease\b/i, /\bbản phát hành\b/i, /\bsince v\d/i, /\bafter the release\b/i],
  feedback_feature: [/\bfeature\b/i, /\bsince we shipped\b/i, /\btính năng đó\b/i],
  strategic_input: [
    /\bpivot\b/i,
    /\bdirection\b/i,
    /\bstrategy\b/i,
    /\bdoubl(?:e|ing) down\b/i,
    /\bđổi hướng\b/i,
    /\bchiến lược\b/i,
  ],
  question: [
    /\bhow does\b/i,
    /\bwhat is\b/i,
    /\bwhy does\b/i,
    /\bcan you explain\b/i,
    /\bcâu hỏi\b/i,
    /\btại sao\b/i,
    /\?\s*$/,
  ],
};

const STRONG_BUG_BOOST = /\b(?:steps to reproduce|stack trace|repro)\b/i;
const QUESTION_MARK = /\?\s*$/;

export function classifyIntake(input: ClassifyInput): ClassifyResult {
  if (input.prefilledType) {
    return {
      type: input.prefilledType,
      confidence: 1,
      alternatives: [],
      source: "prefilled",
    };
  }
  if (input.linkedReleaseTag) {
    return {
      type: "feedback_release",
      confidence: 0.95,
      alternatives: [],
      source: "linked_release",
    };
  }
  if (input.linkedFeatureKey) {
    return {
      type: "feedback_feature",
      confidence: 0.9,
      alternatives: [],
      source: "linked_feature",
    };
  }

  const scores = scoreText(input.text);
  // Bug-vs-problem disambiguation: explicit repro pushes bug_report ahead.
  if (STRONG_BUG_BOOST.test(input.text)) {
    bumpScore(scores, "bug_report", 2);
  }
  // Trailing question mark + no other strong matches → question.
  if (QUESTION_MARK.test(input.text) && totalScore(scores) <= 1) {
    bumpScore(scores, "question", 1.5);
  }

  scores.sort((a, b) => b.score - a.score);
  const top = scores[0]!;
  const second = scores[1] ?? { type: "feedback_general", score: 0 };
  const total = totalScore(scores);
  const confidence = total === 0 ? 0.2 : Math.min(0.99, top.score / Math.max(total, 1));

  return {
    type: top.score === 0 ? "feedback_general" : top.type,
    confidence,
    alternatives: scores
      .slice(1, 4)
      .filter((e) => e.score > 0)
      .map((e) => ({ type: e.type, score: e.score })),
    source: "heuristic",
  };
}

function scoreText(text: string): ScoreEntry[] {
  return Object.entries(RULES).map(([type, patterns]) => ({
    type: type as IntakeType,
    score: patterns.reduce((acc, p) => acc + (p.test(text) ? 1 : 0), 0),
  }));
}

function bumpScore(scores: ScoreEntry[], type: IntakeType, by: number) {
  const entry = scores.find((s) => s.type === type);
  if (entry) entry.score += by;
}

function totalScore(scores: ScoreEntry[]): number {
  return scores.reduce((a, b) => a + b.score, 0);
}
