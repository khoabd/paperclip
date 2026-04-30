// Decides whether an agent action auto-approves, must gate to a human, or is rejected outright.
// Inputs: workspace autonomy_level, capability mode (workspace override > capability default),
// proposal pattern, agent confidence, computed risk_score.
// Phase 3 thresholds are hard-coded; Phase 9 will turn them into Brier-tuned per-workspace values.
// Per Phase-3-Autonomy-Dial-Approval-Patterns §3.2.

import type { AutonomyLevel } from "../workspace-context.js";
import type { ProposalPatternKey } from "./proposal-patterns.js";
import { PROPOSAL_PATTERN_META } from "./proposal-patterns.js";

export type { AutonomyLevel } from "../workspace-context.js";
export type CapabilityMode = "sandbox" | "supervised" | "trusted" | "autonomous";

export type GateDecision = "auto_approve" | "gate" | "reject";

export interface GateInput {
  autonomyLevel: AutonomyLevel;
  capabilityMode: CapabilityMode;
  proposalPattern: ProposalPatternKey;
  /** Agent's self-reported P(success) ∈ [0,1]. */
  confidence: number;
  /** Computed risk ∈ [0,1]. */
  riskScore: number;
}

export interface GateResult {
  decision: GateDecision;
  reason: string;
  effectiveMode: CapabilityMode;
}

const MODE_RANK: Record<CapabilityMode, number> = {
  sandbox: 0,
  supervised: 1,
  trusted: 2,
  autonomous: 3,
};

/**
 * Effective mode = least permissive of (workspace autonomy, capability mode).
 */
export function effectiveMode(autonomy: AutonomyLevel, capability: CapabilityMode): CapabilityMode {
  return MODE_RANK[autonomy] <= MODE_RANK[capability] ? autonomy : capability;
}

const HIGH_RISK_HARD_GATE = 0.85;

const SUPERVISED_CONFIDENCE_FLOOR = 0.8;
const SUPERVISED_RISK_CEILING = 0.3;

const TRUSTED_CONFIDENCE_FLOOR = 0.6;
const TRUSTED_RISK_CEILING = 0.55;

export class AutonomyGate {
  decide(input: GateInput): GateResult {
    const { autonomyLevel, capabilityMode, proposalPattern, confidence, riskScore } = input;
    assertProb(confidence, "confidence");
    assertProb(riskScore, "riskScore");

    const mode = effectiveMode(autonomyLevel, capabilityMode);
    const meta = PROPOSAL_PATTERN_META[proposalPattern];

    if (riskScore >= HIGH_RISK_HARD_GATE) {
      return gate(`risk_score ${riskScore.toFixed(3)} ≥ ${HIGH_RISK_HARD_GATE}`, mode);
    }
    if (meta.alwaysGate) {
      return gate(`pattern '${proposalPattern}' always gates`, mode);
    }

    switch (mode) {
      case "sandbox":
        return gate("effective_mode=sandbox always gates", mode);
      case "supervised":
        if (confidence < SUPERVISED_CONFIDENCE_FLOOR) {
          return gate(
            `supervised: confidence ${confidence.toFixed(3)} < ${SUPERVISED_CONFIDENCE_FLOOR}`,
            mode,
          );
        }
        if (riskScore > SUPERVISED_RISK_CEILING) {
          return gate(
            `supervised: risk ${riskScore.toFixed(3)} > ${SUPERVISED_RISK_CEILING}`,
            mode,
          );
        }
        return auto("supervised + confidence/risk within bounds", mode);
      case "trusted":
        if (confidence < TRUSTED_CONFIDENCE_FLOOR) {
          return gate(
            `trusted: confidence ${confidence.toFixed(3)} < ${TRUSTED_CONFIDENCE_FLOOR}`,
            mode,
          );
        }
        if (riskScore > TRUSTED_RISK_CEILING) {
          return gate(`trusted: risk ${riskScore.toFixed(3)} > ${TRUSTED_RISK_CEILING}`, mode);
        }
        return auto("trusted + confidence/risk within bounds", mode);
      case "autonomous":
        return auto("autonomous", mode);
      default:
        return gate(`unknown effective_mode '${mode as string}'`, mode);
    }
  }
}

function gate(reason: string, mode: CapabilityMode): GateResult {
  return { decision: "gate", reason, effectiveMode: mode };
}

function auto(reason: string, mode: CapabilityMode): GateResult {
  return { decision: "auto_approve", reason, effectiveMode: mode };
}

function assertProb(v: number, name: string): void {
  if (!Number.isFinite(v) || v < 0 || v > 1) {
    throw new Error(`${name} must be a finite probability in [0,1], got ${v}`);
  }
}
