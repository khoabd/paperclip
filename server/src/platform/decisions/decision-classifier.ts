// Pure decision classifier — no DB calls.
// Maps (kind, reversibility, blastRadius) → { threshold, defaultPattern }
// applying the autonomy-level factor per Phase 9 spec.
// Per Decision-Boundary-and-Uncertainty-Model §3.4 and Phase 9 threshold matrix.

import type { CapabilityMode } from "../autonomy/autonomy-gate.js";

export type Reversibility = "easy" | "hard" | "irreversible";
export type BlastRadius = "local" | "workspace" | "company" | "global";

export interface ClassifyInput {
  kind: string;
  reversibility: Reversibility;
  blastRadius: BlastRadius;
  /** Effective capability mode (sandbox/supervised/trusted/autonomous). Defaults to "trusted". */
  capabilityMode?: CapabilityMode;
}

export interface ClassifyResult {
  /** Effective confidence threshold — gate fires when agent confidence < threshold. */
  threshold: number;
  /** Suggested proposal pattern for gated decisions. */
  defaultPattern: string;
  /** Base threshold before autonomy factor. */
  baseThreshold: number;
  /** Autonomy factor applied (multiplier). */
  autonomyFactor: number;
}

// ---------------------------------------------------------------------------
// Base threshold matrix: reversibility × blastRadius
// Source: Phase 9 spec + Decision-Boundary-and-Uncertainty-Model §4
// ---------------------------------------------------------------------------
const BASE_THRESHOLDS: Record<Reversibility, Record<BlastRadius, number>> = {
  easy: {
    local:     0.65,
    workspace: 0.65,
    company:   0.75,
    global:    0.75,
  },
  hard: {
    local:     0.78,
    workspace: 0.78,
    company:   0.85,
    global:    0.92,
  },
  irreversible: {
    local:     0.80,
    workspace: 0.90,
    company:   0.95,
    global:    0.99,
  },
};

// Default proposal pattern per blast radius
const DEFAULT_PATTERN: Record<BlastRadius, string> = {
  local:     "code_change",
  workspace: "external_action",
  company:   "external_action",
  global:    "policy_exception",
};

// Override patterns for high-sensitivity reversibility × blast combos
function resolveDefaultPattern(reversibility: Reversibility, blastRadius: BlastRadius): string {
  if (reversibility === "irreversible" && (blastRadius === "company" || blastRadius === "global")) {
    return "policy_exception";
  }
  if (reversibility === "hard" && blastRadius === "global") {
    return "policy_exception";
  }
  return DEFAULT_PATTERN[blastRadius];
}

// ---------------------------------------------------------------------------
// AUTONOMY_THRESHOLD_FACTOR per capability mode
// sandbox=1.10 (requires more confidence), supervised=1.05, trusted=1.00, autonomous=0.95
// Higher factor → higher effective threshold → harder to auto-approve
// ---------------------------------------------------------------------------
const AUTONOMY_FACTOR: Record<CapabilityMode, number> = {
  sandbox:    1.10,
  supervised: 1.05,
  trusted:    1.00,
  autonomous: 0.95,
};

const MAX_THRESHOLD = 0.99;

export class DecisionClassifier {
  classify(input: ClassifyInput): ClassifyResult {
    const { reversibility, blastRadius, capabilityMode = "trusted" } = input;

    const base = BASE_THRESHOLDS[reversibility]?.[blastRadius];
    if (base === undefined) {
      throw new Error(
        `Unknown (reversibility, blastRadius) pair: (${reversibility}, ${blastRadius})`,
      );
    }

    const factor = AUTONOMY_FACTOR[capabilityMode];
    const raw = base * factor;
    const threshold = Math.min(raw, MAX_THRESHOLD);

    return {
      threshold,
      defaultPattern: resolveDefaultPattern(reversibility, blastRadius),
      baseThreshold: base,
      autonomyFactor: factor,
    };
  }
}

// Expose constants for tests
export { BASE_THRESHOLDS, AUTONOMY_FACTOR, MAX_THRESHOLD };
