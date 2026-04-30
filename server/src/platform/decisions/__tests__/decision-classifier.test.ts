// Unit tests for DecisionClassifier — covers the full Reversibility × BlastRadius × AutonomyMode matrix.
// Gate criterion: ≥8 matrix cells × 4 autonomy levels (sample of representative combinations).

import { describe, expect, it } from "vitest";
import {
  DecisionClassifier,
  BASE_THRESHOLDS,
  AUTONOMY_FACTOR,
  MAX_THRESHOLD,
} from "../decision-classifier.js";

const clf = new DecisionClassifier();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function expectedThreshold(
  reversibility: "easy" | "hard" | "irreversible",
  blastRadius: "local" | "workspace" | "company" | "global",
  mode: "sandbox" | "supervised" | "trusted" | "autonomous",
): number {
  const base = BASE_THRESHOLDS[reversibility][blastRadius];
  const factor = AUTONOMY_FACTOR[mode];
  return Math.min(base * factor, MAX_THRESHOLD);
}

// ---------------------------------------------------------------------------
// Matrix cell tests — reversibility × blastRadius (8 cells × 4 modes)
// ---------------------------------------------------------------------------

describe("DecisionClassifier — easy × local (base 0.65)", () => {
  it("sandbox: threshold = min(0.65 × 1.10, 0.99) = 0.715", () => {
    const r = clf.classify({ kind: "generic", reversibility: "easy", blastRadius: "local", capabilityMode: "sandbox" });
    expect(r.threshold).toBeCloseTo(expectedThreshold("easy", "local", "sandbox"), 6);
    expect(r.baseThreshold).toBe(0.65);
    expect(r.autonomyFactor).toBe(1.10);
    expect(r.defaultPattern).toBe("code_change");
  });
  it("supervised: threshold = 0.65 × 1.05 = 0.6825", () => {
    const r = clf.classify({ kind: "generic", reversibility: "easy", blastRadius: "local", capabilityMode: "supervised" });
    expect(r.threshold).toBeCloseTo(expectedThreshold("easy", "local", "supervised"), 6);
  });
  it("trusted: threshold = 0.65 × 1.00 = 0.65", () => {
    const r = clf.classify({ kind: "generic", reversibility: "easy", blastRadius: "local", capabilityMode: "trusted" });
    expect(r.threshold).toBeCloseTo(0.65, 6);
  });
  it("autonomous: threshold = 0.65 × 0.95 = 0.6175", () => {
    const r = clf.classify({ kind: "generic", reversibility: "easy", blastRadius: "local", capabilityMode: "autonomous" });
    expect(r.threshold).toBeCloseTo(expectedThreshold("easy", "local", "autonomous"), 6);
  });
});

describe("DecisionClassifier — easy × company (base 0.75)", () => {
  it("sandbox: 0.75 × 1.10 = 0.825", () => {
    const r = clf.classify({ kind: "generic", reversibility: "easy", blastRadius: "company", capabilityMode: "sandbox" });
    expect(r.threshold).toBeCloseTo(expectedThreshold("easy", "company", "sandbox"), 6);
  });
  it("trusted: 0.75 × 1.00 = 0.75", () => {
    const r = clf.classify({ kind: "generic", reversibility: "easy", blastRadius: "company", capabilityMode: "trusted" });
    expect(r.threshold).toBeCloseTo(0.75, 6);
  });
  it("autonomous: 0.75 × 0.95 = 0.7125", () => {
    const r = clf.classify({ kind: "generic", reversibility: "easy", blastRadius: "company", capabilityMode: "autonomous" });
    expect(r.threshold).toBeCloseTo(expectedThreshold("easy", "company", "autonomous"), 6);
  });
});

describe("DecisionClassifier — hard × workspace (base 0.78)", () => {
  it("sandbox: 0.78 × 1.10 = 0.858", () => {
    const r = clf.classify({ kind: "code_change", reversibility: "hard", blastRadius: "workspace", capabilityMode: "sandbox" });
    expect(r.threshold).toBeCloseTo(expectedThreshold("hard", "workspace", "sandbox"), 6);
    expect(r.defaultPattern).toBe("external_action");
  });
  it("supervised: 0.78 × 1.05 = 0.819", () => {
    const r = clf.classify({ kind: "code_change", reversibility: "hard", blastRadius: "workspace", capabilityMode: "supervised" });
    expect(r.threshold).toBeCloseTo(expectedThreshold("hard", "workspace", "supervised"), 6);
  });
  it("trusted: 0.78 × 1.00 = 0.78", () => {
    const r = clf.classify({ kind: "code_change", reversibility: "hard", blastRadius: "workspace", capabilityMode: "trusted" });
    expect(r.threshold).toBeCloseTo(0.78, 6);
  });
  it("autonomous: 0.78 × 0.95 = 0.741", () => {
    const r = clf.classify({ kind: "code_change", reversibility: "hard", blastRadius: "workspace", capabilityMode: "autonomous" });
    expect(r.threshold).toBeCloseTo(expectedThreshold("hard", "workspace", "autonomous"), 6);
  });
});

describe("DecisionClassifier — hard × company (base 0.85)", () => {
  it("trusted: 0.85 × 1.00 = 0.85", () => {
    const r = clf.classify({ kind: "deploy", reversibility: "hard", blastRadius: "company", capabilityMode: "trusted" });
    expect(r.threshold).toBeCloseTo(0.85, 6);
    expect(r.defaultPattern).toBe("external_action");
  });
  it("autonomous: 0.85 × 0.95 = 0.8075", () => {
    const r = clf.classify({ kind: "deploy", reversibility: "hard", blastRadius: "company", capabilityMode: "autonomous" });
    expect(r.threshold).toBeCloseTo(expectedThreshold("hard", "company", "autonomous"), 6);
  });
  it("sandbox: 0.85 × 1.10 = 0.935", () => {
    const r = clf.classify({ kind: "deploy", reversibility: "hard", blastRadius: "company", capabilityMode: "sandbox" });
    expect(r.threshold).toBeCloseTo(expectedThreshold("hard", "company", "sandbox"), 6);
  });
});

describe("DecisionClassifier — hard × global (base 0.92)", () => {
  it("trusted: 0.92 × 1.00 = 0.92, pattern=policy_exception", () => {
    const r = clf.classify({ kind: "policy_exception", reversibility: "hard", blastRadius: "global", capabilityMode: "trusted" });
    expect(r.threshold).toBeCloseTo(0.92, 6);
    expect(r.defaultPattern).toBe("policy_exception");
  });
  it("sandbox: 0.92 × 1.10 = 1.012 → clamped to 0.99", () => {
    const r = clf.classify({ kind: "policy_exception", reversibility: "hard", blastRadius: "global", capabilityMode: "sandbox" });
    expect(r.threshold).toBe(MAX_THRESHOLD);
  });
  it("autonomous: 0.92 × 0.95 = 0.874", () => {
    const r = clf.classify({ kind: "policy_exception", reversibility: "hard", blastRadius: "global", capabilityMode: "autonomous" });
    expect(r.threshold).toBeCloseTo(expectedThreshold("hard", "global", "autonomous"), 6);
  });
});

describe("DecisionClassifier — irreversible × workspace (base 0.90)", () => {
  it("sandbox: 0.90 × 1.10 = 0.99 (clamped)", () => {
    const r = clf.classify({ kind: "migration", reversibility: "irreversible", blastRadius: "workspace", capabilityMode: "sandbox" });
    expect(r.threshold).toBe(MAX_THRESHOLD);
  });
  it("supervised: 0.90 × 1.05 = 0.945", () => {
    const r = clf.classify({ kind: "migration", reversibility: "irreversible", blastRadius: "workspace", capabilityMode: "supervised" });
    expect(r.threshold).toBeCloseTo(expectedThreshold("irreversible", "workspace", "supervised"), 6);
  });
  it("trusted: 0.90 × 1.00 = 0.90", () => {
    const r = clf.classify({ kind: "migration", reversibility: "irreversible", blastRadius: "workspace", capabilityMode: "trusted" });
    expect(r.threshold).toBeCloseTo(0.90, 6);
  });
  it("autonomous: 0.90 × 0.95 = 0.855", () => {
    const r = clf.classify({ kind: "migration", reversibility: "irreversible", blastRadius: "workspace", capabilityMode: "autonomous" });
    expect(r.threshold).toBeCloseTo(expectedThreshold("irreversible", "workspace", "autonomous"), 6);
  });
});

describe("DecisionClassifier — irreversible × company (base 0.95)", () => {
  it("trusted: 0.95 × 1.00 = 0.95, pattern=policy_exception", () => {
    const r = clf.classify({ kind: "data_export", reversibility: "irreversible", blastRadius: "company", capabilityMode: "trusted" });
    expect(r.threshold).toBeCloseTo(0.95, 6);
    expect(r.defaultPattern).toBe("policy_exception");
  });
  it("autonomous: 0.95 × 0.95 = 0.9025", () => {
    const r = clf.classify({ kind: "data_export", reversibility: "irreversible", blastRadius: "company", capabilityMode: "autonomous" });
    expect(r.threshold).toBeCloseTo(expectedThreshold("irreversible", "company", "autonomous"), 6);
  });
  it("sandbox: 0.95 × 1.10 = 1.045 → clamped to 0.99", () => {
    const r = clf.classify({ kind: "data_export", reversibility: "irreversible", blastRadius: "company", capabilityMode: "sandbox" });
    expect(r.threshold).toBe(MAX_THRESHOLD);
  });
});

describe("DecisionClassifier — irreversible × global (base 0.99)", () => {
  it("sandbox/supervised/trusted clamp at 0.99 (factor ≥ 1.00)", () => {
    for (const mode of ["sandbox", "supervised", "trusted"] as const) {
      const r = clf.classify({ kind: "generic", reversibility: "irreversible", blastRadius: "global", capabilityMode: mode });
      // 0.99 × 1.10 / 1.05 / 1.00 → all ≥ 0.99, clamped to MAX_THRESHOLD
      expect(r.threshold).toBe(MAX_THRESHOLD);
    }
  });
  it("autonomous: 0.99 × 0.95 = 0.9405 (below cap, not clamped)", () => {
    const r = clf.classify({ kind: "generic", reversibility: "irreversible", blastRadius: "global", capabilityMode: "autonomous" });
    // autonomous lowers the bar slightly; 0.9405 is still very high
    expect(r.threshold).toBeCloseTo(expectedThreshold("irreversible", "global", "autonomous"), 6);
    expect(r.threshold).toBeCloseTo(0.9405, 4);
  });
  it("pattern is policy_exception", () => {
    const r = clf.classify({ kind: "generic", reversibility: "irreversible", blastRadius: "global", capabilityMode: "trusted" });
    expect(r.defaultPattern).toBe("policy_exception");
  });
});

describe("DecisionClassifier — default capabilityMode", () => {
  it("defaults to trusted when capabilityMode omitted", () => {
    const r = clf.classify({ kind: "generic", reversibility: "easy", blastRadius: "local" });
    expect(r.autonomyFactor).toBe(1.00); // trusted factor
    expect(r.threshold).toBeCloseTo(0.65, 6);
  });
});

describe("DecisionClassifier — invalid inputs", () => {
  it("throws on unknown reversibility", () => {
    expect(() =>
      clf.classify({ kind: "x", reversibility: "medium" as any, blastRadius: "local" }),
    ).toThrow();
  });
  it("throws on unknown blastRadius", () => {
    expect(() =>
      clf.classify({ kind: "x", reversibility: "easy", blastRadius: "planetary" as any }),
    ).toThrow();
  });
});
